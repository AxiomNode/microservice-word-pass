import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AppConfig } from "../config.js";
import { prisma } from "../db/client.js";
import {
  AiEngineClient,
  AiEngineClientObserver,
  IngestDocumentInput,
  IngestResponse
} from "./aiEngineClient.js";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_BY_CODE,
  TRIVIA_CATEGORIES,
  TRIVIA_CATEGORY_BY_ID,
  TriviaCategory
} from "./triviaCategories.js";

export interface CatalogSnapshot {
  source: "local-fallback" | "ai-engine";
  categories: { id: string; name: string }[];
  languages: { code: string; name: string }[];
  updatedAt: string;
}

export interface AiAuthCircuitSnapshot {
  open: boolean;
  failureStreak: number;
  failureThreshold: number;
  openedUntil?: string;
  cooldownMs: number;
  openedTotal: number;
}

export interface GenerationServiceObserver {
  onModelStored?: () => void;
  onModelDuplicate?: (reason: "topic" | "content") => void;
  onModelFailed?: () => void;
  onAiAuthCircuitStateChanged?: (state: AiAuthCircuitSnapshot) => void;
  onProcessStarted?: (payload: { taskId: string; requested: number }) => void;
  onProcessCompleted?: (snapshot: GenerationProcessSnapshot) => void;
  onBatchCompleted?: (result: BatchGenerationResult) => void;
  onOutboundRequest?: AiEngineClientObserver["onOutboundRequest"];
}

export interface GenerateInput {
  categoryId: string;
  language: string;
  difficultyPercentage?: number;
  numQuestions?: number;
  letters?: string;
}

export interface ManualModelInput {
  categoryId: string;
  language: string;
  difficultyPercentage: number;
  content: Record<string, unknown>;
  status?: "manual" | "validated";
}

export interface GenerationProcessInput extends GenerateInput {
  count: number;
}

export interface GenerationProcessSnapshot {
  taskId: string;
  status: "running" | "completed" | "failed";
  requested: number;
  processed: number;
  created: number;
  duplicates: number;
  duplicateReasons: {
    topic: number;
    content: number;
  };
  failed: number;
  progress: {
    current: number;
    total: number;
    ratio: number;
  };
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  generatedItems?: unknown[];
  errors?: string[];
}

interface ResolvedGenerateInput extends GenerateInput {
  topic: string;
  query: string;
}

export interface RandomModelsFilters {
  count: number;
  categoryId?: string;
  language?: string;
  status?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface GroupedModelsSummary {
  categories: Array<{ categoryId: string; categoryName: string; total: number }>;
  languages: Array<{ language: string; total: number }>;
  matrix: Array<{ categoryId: string; categoryName: string; language: string; total: number }>;
}

export interface BatchGenerationResult {
  runId: string;
  requested: number;
  attempts: number;
  created: number;
  duplicates: number;
  failed: number;
}

interface BatchGenerationOptions {
  targetCount?: number;
  maxAttempts?: number;
}

interface GenerateAndStoreResult {
  stored: boolean;
  duplicateReason?: "topic" | "content";
  responsePayload: unknown;
}

interface GenerateStoreMetadata {
  category?: TriviaCategory;
  batchRunId?: string;
}

interface StoredGameModel {
  id: string;
  gameType: string;
  topic: string;
  query: string;
  language: string;
  status: string;
  categoryId: string | null;
  categoryName: string | null;
  request: unknown;
  response: unknown;
  createdAt: Date;
}

interface GenerationProcessTask {
  taskId: string;
  status: "running" | "completed" | "failed";
  requested: number;
  processed: number;
  created: number;
  duplicates: number;
  duplicateByTopic: number;
  duplicateByContent: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  generatedItems: unknown[];
  errors: string[];
}

const TOPIC_VARIANTS = [
  "fundamentos",
  "curiosidades",
  "personajes clave",
  "eventos historicos",
  "conceptos esenciales",
  "hechos poco conocidos",
  "hitos recientes",
  "contexto global",
  "impacto cultural",
  "innovaciones",
  "aplicaciones practicas",
  "retos actuales",
  "clasicos",
  "perspectiva internacional",
  "datos sorprendentes",
  "figuras influyentes"
];

const CONTEXT_FRAMES = [
  "introduccion",
  "nivel intermedio",
  "nivel avanzado",
  "comparativa historica",
  "enfoque moderno",
  "casos emblematicos",
  "enfoque educativo",
  "vision interdisciplinar"
];

const LETTER_SETS = [
  "A,B,C,D,E,F,G,H,I,J,L,M,N,O,P,R,S,T,V,Z",
  "A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z",
  "A,C,E,G,I,K,L,M,N,O,P,R,S,T,U,V"
];

export class GenerationService {
  private readonly client: AiEngineClient;
  private readonly generationProcesses = new Map<string, GenerationProcessTask>();
  private readonly generationProcessRetentionLimit = 200;
  private readonly aiAuthFailureThreshold: number;
  private readonly aiAuthCircuitCooldownMs: number;
  private aiAuthFailureStreak = 0;
  private aiAuthCircuitOpenedUntilMs = 0;
  private aiAuthCircuitOpenedTotal = 0;
  private categories: { id: string; name: string }[] = [...TRIVIA_CATEGORIES];
  private languages: { code: string; name: string }[] = [...SUPPORTED_LANGUAGES];
  private categoryById = new Map(TRIVIA_CATEGORY_BY_ID);
  private languageByCode = new Map(SUPPORTED_LANGUAGE_BY_CODE);
  private catalogSource: CatalogSnapshot["source"] = "local-fallback";
  private catalogUpdatedAt = new Date().toISOString();

  constructor(
    private readonly config: AppConfig,
    private readonly observer?: GenerationServiceObserver
  ) {
    this.aiAuthFailureThreshold = config.AI_AUTH_CIRCUIT_FAILURE_THRESHOLD;
    this.aiAuthCircuitCooldownMs = config.AI_AUTH_CIRCUIT_COOLDOWN_MS;
    this.client = new AiEngineClient(config, {
      onOutboundRequest: (metric) => this.observer?.onOutboundRequest?.(metric)
    });
  }

  async refreshCatalogs(): Promise<CatalogSnapshot> {
    try {
      this.ensureAiAuthCircuitClosed();
      const payload = await this.client.getCatalogs();
      this.registerAiAuthSuccess();
      this.categories = payload.categories;
      this.languages = payload.languages;
      this.categoryById = new Map(payload.categories.map((item) => [item.id, item] as const));
      this.languageByCode = new Map(
        payload.languages.map((item) => [item.code.toLowerCase(), item] as const)
      );
      this.catalogSource = "ai-engine";
      this.catalogUpdatedAt = new Date().toISOString();
    } catch (error) {
      this.registerAiAuthFailure(error);
      this.catalogSource = "local-fallback";
      this.catalogUpdatedAt = new Date().toISOString();
    }
    return this.getCatalogSnapshot();
  }

  async runAiAuthSmokeCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      this.ensureAiAuthCircuitClosed();
      await this.client.getCatalogs();
      this.registerAiAuthSuccess();
      return { ok: true };
    } catch (error) {
      this.registerAiAuthFailure(error);
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Unknown ai-engine error"
      };
    }
  }

  assertAiGenerationAvailable(): void {
    this.ensureAiAuthCircuitClosed();
  }

  getAiAuthCircuitSnapshot(): AiAuthCircuitSnapshot {
    const open = this.aiAuthCircuitOpenedUntilMs > Date.now();
    return {
      open,
      failureStreak: this.aiAuthFailureStreak,
      failureThreshold: this.aiAuthFailureThreshold,
      ...(open ? { openedUntil: new Date(this.aiAuthCircuitOpenedUntilMs).toISOString() } : {}),
      cooldownMs: this.aiAuthCircuitCooldownMs,
      openedTotal: this.aiAuthCircuitOpenedTotal
    };
  }

  getCatalogSnapshot(): CatalogSnapshot {
    return {
      source: this.catalogSource,
      categories: this.categories,
      languages: this.languages,
      updatedAt: this.catalogUpdatedAt
    };
  }

  async generateAndStore(input: GenerateInput): Promise<unknown> {
    const category = this.getCategoryOrThrow(input.categoryId);
    const language = this.getLanguageOrThrow(input.language);

    const resolved = this.buildResolvedInput(Math.floor(Math.random() * 10_000), category, language);
    const result = await this.generateAndStoreWithResult({
      ...resolved,
      difficultyPercentage: input.difficultyPercentage,
      numQuestions: input.numQuestions,
      letters: input.letters
    });

    return result.responsePayload;
  }

  async storeManualModel(input: ManualModelInput): Promise<StoredGameModel> {
    const category = this.getCategoryOrThrow(input.categoryId);
    const language = this.getLanguageOrThrow(input.language);
    const difficulty = Math.max(0, Math.min(100, Math.trunc(input.difficultyPercentage)));

    const normalizedContent = this.normalizeManualContent(input.content);
    const topic = `${category.name} | manual | ${language} | d${difficulty}`;
    const query = `${category.name} manual curation ${language} difficulty ${difficulty}`;
    const topicKey = this.normalizeTopicKey(topic, language);
    const uniquenessKey = this.buildUniquenessKey("word-pass", normalizedContent, language);

    const existing = await prisma.gameGeneration.findFirst({
      where: { uniquenessKey },
      select: { id: true },
    });

    if (existing) {
      throw new Error("Duplicate content");
    }

    const created = await prisma.gameGeneration.create({
      data: {
        gameType: "word-pass",
        topic,
        topicKey,
        query,
        language,
        status: input.status ?? "manual",
        categoryId: category.id,
        categoryName: category.name,
        uniquenessKey,
        requestJson: JSON.stringify({
          source: "backoffice-manual",
          categoryId: category.id,
          language,
          difficulty_percentage: difficulty,
        }),
        responseJson: JSON.stringify(normalizedContent),
      },
    });

    return this.mapStoredModel(created);
  }

  async deleteHistoryItem(id: string): Promise<boolean> {
    const deleted = await prisma.gameGeneration.deleteMany({
      where: {
        id,
        gameType: "word-pass",
      },
    });
    return deleted.count > 0;
  }

  startGenerationProcess(input: GenerationProcessInput): GenerationProcessSnapshot {
    const task: GenerationProcessTask = {
      taskId: randomUUID(),
      status: "running",
      requested: input.count,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByTopic: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generatedItems: [],
      errors: []
    };

    this.generationProcesses.set(task.taskId, task);
    this.pruneGenerationProcesses();
    this.observer?.onProcessStarted?.({ taskId: task.taskId, requested: task.requested });
    void this.runGenerationProcess(task.taskId, input);

    return this.toGenerationProcessSnapshot(task);
  }

  getGenerationProcess(taskId: string, includeItems = false): GenerationProcessSnapshot | null {
    const task = this.generationProcesses.get(taskId);
    if (!task) {
      return null;
    }
    return this.toGenerationProcessSnapshot(task, includeItems);
  }

  listGenerationProcesses(limit = 20): GenerationProcessSnapshot[] {
    return [...this.generationProcesses.values()]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(1, limit))
      .map((task) => this.toGenerationProcessSnapshot(task));
  }

  async generateBatchModels(options?: BatchGenerationOptions): Promise<BatchGenerationResult> {
    const targetCount = options?.targetCount ?? this.config.BATCH_GENERATION_TARGET_COUNT;
    const maxAttempts = options?.maxAttempts ?? this.config.BATCH_GENERATION_MAX_ATTEMPTS;
    const concurrency = this.config.BATCH_GENERATION_CONCURRENCY;
    const runId = randomUUID();

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    let attempts = 0;
    const dimensions = this.buildDimensionMatrix();
    const matrixOffset = Math.floor(Math.random() * dimensions.length);

    const workers = Array.from({ length: concurrency }, () =>
      (async () => {
        while (attempts < maxAttempts && created < targetCount) {
          const attemptNumber = attempts;
          attempts += 1;

          const selection = dimensions[(matrixOffset + attemptNumber) % dimensions.length];
          const candidateInput = this.buildResolvedInput(
            attemptNumber,
            selection.category,
            selection.language
          );

          try {
            const result = await this.generateAndStoreWithResult(candidateInput, {
              category: selection.category,
              batchRunId: runId
            });

            if (result.stored) {
              created += 1;
            } else {
              duplicates += 1;
            }
          } catch (error) {
            failed += 1;
            if (this.isAiAuthCircuitOpenError(error)) {
              attempts = maxAttempts;
              break;
            }
          }
        }
      })()
    );

    await Promise.all(workers);

    const result = {
      runId,
      requested: targetCount,
      attempts,
      created,
      duplicates,
      failed
    };
    this.observer?.onBatchCompleted?.(result);
    return result;
  }

  async ingestToRag(documents: IngestDocumentInput[], source?: string): Promise<IngestResponse> {
    const ingestSource = source ?? this.config.AI_ENGINE_INGEST_SOURCE ?? this.config.SERVICE_NAME;
    return this.client.ingest(documents, ingestSource);
  }

  async randomModels(filters: RandomModelsFilters): Promise<StoredGameModel[]> {
    const where: Prisma.GameGenerationWhereInput = {
      gameType: "word-pass"
    };

    if (filters.language) {
      where.language = this.getLanguageOrThrow(filters.language);
    }
    if (filters.categoryId) {
      where.categoryId = this.getCategoryOrThrow(filters.categoryId).id;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.createdAfter || filters.createdBefore) {
      where.createdAt = {
        ...(filters.createdAfter ? { gte: filters.createdAfter } : {}),
        ...(filters.createdBefore ? { lte: filters.createdBefore } : {})
      };
    }

    const candidates = await prisma.gameGeneration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(1000, Math.max(filters.count * 30, 300))
    });

    if (candidates.length === 0) {
      return [];
    }

    const shuffled = [...candidates];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const current = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = current;
    }

    const selected = shuffled.slice(0, Math.min(filters.count, shuffled.length));
    return selected.map((item) => this.mapStoredModel(item));
  }

  async groupedModelsSummary(): Promise<GroupedModelsSummary> {
    const rows = await prisma.gameGeneration.groupBy({
      by: ["categoryId", "categoryName", "language"],
      where: { gameType: "word-pass" },
      _count: { _all: true }
    });

    const matrix = rows
      .filter((row) => row.categoryId && row.categoryName)
      .map((row) => ({
        categoryId: row.categoryId as string,
        categoryName: row.categoryName as string,
        language: row.language,
        total: row._count._all
      }));

    const categories = this.categories.map((category) => {
      const total = matrix
        .filter((row) => row.categoryId === category.id)
        .reduce((sum, row) => sum + row.total, 0);
      return {
        categoryId: category.id,
        categoryName: category.name,
        total
      };
    });

    const languages = this.languages.map((item) => item.code).map((language) => {
      const total = matrix
        .filter((row) => row.language === language)
        .reduce((sum, row) => sum + row.total, 0);
      return { language, total };
    });

    return {
      categories,
      languages,
      matrix
    };
  }

  async history(limit = 20): Promise<StoredGameModel[]> {
    const rows = await prisma.gameGeneration.findMany({
      where: { gameType: "word-pass" },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return rows.map((item) => this.mapStoredModel(item));
  }

  private async runGenerationProcess(taskId: string, input: GenerationProcessInput): Promise<void> {
    const task = this.generationProcesses.get(taskId);
    if (!task) {
      return;
    }

    try {
      const category = this.getCategoryOrThrow(input.categoryId);
      const language = this.getLanguageOrThrow(input.language);

      for (let index = 0; index < input.count; index += 1) {
        const resolved = this.buildResolvedInput(index, category, language);
        const payload: ResolvedGenerateInput = {
          ...resolved,
          difficultyPercentage: input.difficultyPercentage ?? resolved.difficultyPercentage,
          numQuestions: input.numQuestions ?? resolved.numQuestions,
          letters: input.letters ?? resolved.letters
        };

        try {
          const result = await this.generateAndStoreWithResult(payload, {
            category,
            batchRunId: task.taskId
          });
          if (result.stored) {
            task.created += 1;
            task.generatedItems.push(result.responsePayload);
          } else {
            task.duplicates += 1;
            if (result.duplicateReason === "topic") {
              task.duplicateByTopic += 1;
            }
            if (result.duplicateReason === "content") {
              task.duplicateByContent += 1;
            }
          }
        } catch (error) {
          task.failed += 1;
          if (task.errors.length < 25) {
            task.errors.push(error instanceof Error ? error.message : "Generation failed");
          }
        }

        task.processed = index + 1;
        task.updatedAt = new Date().toISOString();
      }

      const producedAtLeastOne = task.created > 0 || task.duplicates > 0;
      const hasOnlyFailures = task.failed > 0 && !producedAtLeastOne;
      task.status = hasOnlyFailures ? "failed" : "completed";
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      this.observer?.onProcessCompleted?.(this.toGenerationProcessSnapshot(task));
    } catch (error) {
      task.status = "failed";
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      task.failed = task.requested;
      if (task.errors.length < 25) {
        task.errors.push(error instanceof Error ? error.message : "Invalid generation input");
      }
      this.observer?.onProcessCompleted?.(this.toGenerationProcessSnapshot(task));
    }
  }

  private toGenerationProcessSnapshot(
    task: GenerationProcessTask,
    includeItems = false
  ): GenerationProcessSnapshot {
    const total = Math.max(1, task.requested);
    return {
      taskId: task.taskId,
      status: task.status,
      requested: task.requested,
      processed: task.processed,
      created: task.created,
      duplicates: task.duplicates,
      duplicateReasons: {
        topic: task.duplicateByTopic,
        content: task.duplicateByContent
      },
      failed: task.failed,
      progress: {
        current: task.processed,
        total: task.requested,
        ratio: Math.min(1, task.processed / total)
      },
      startedAt: task.startedAt,
      updatedAt: task.updatedAt,
      ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
      ...(includeItems || task.status !== "running" ? { generatedItems: task.generatedItems } : {}),
      ...(task.errors.length > 0 ? { errors: task.errors } : {})
    };
  }

  private pruneGenerationProcesses(): void {
    if (this.generationProcesses.size <= this.generationProcessRetentionLimit) {
      return;
    }

    const removable = [...this.generationProcesses.values()]
      .filter((task) => task.status !== "running")
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

    for (const task of removable) {
      if (this.generationProcesses.size <= this.generationProcessRetentionLimit) {
        break;
      }
      this.generationProcesses.delete(task.taskId);
    }
  }

  private buildResolvedInput(
    attempt: number,
    category: { id: string; name: string },
    language: string
  ): ResolvedGenerateInput {
    const categoryCount = this.categories.length;
    const variant = TOPIC_VARIANTS[Math.floor(attempt / categoryCount) % TOPIC_VARIANTS.length];
    const frame =
      CONTEXT_FRAMES[
        Math.floor(attempt / (categoryCount * TOPIC_VARIANTS.length)) % CONTEXT_FRAMES.length
      ];

    const difficulty = this.pickRange(
      this.config.BATCH_GENERATION_MIN_DIFFICULTY,
      this.config.BATCH_GENERATION_MAX_DIFFICULTY
    );
    const numQuestions = this.pickRange(
      this.config.BATCH_GENERATION_MIN_QUESTIONS,
      this.config.BATCH_GENERATION_MAX_QUESTIONS
    );
    const letters = LETTER_SETS[attempt % LETTER_SETS.length];

    return {
      categoryId: category.id,
      language,
      difficultyPercentage: difficulty,
      numQuestions,
      letters,
      topic: `${category.name} - ${variant} - ${frame}`,
      query: `${category.name} ${variant} ${frame} word-pass ${language} evitar respuestas ambiguas o sin sentido`
    };
  }

  private pickRange(min: number, max: number): number {
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
  }

  private async generateAndStoreWithResult(
    input: ResolvedGenerateInput,
    metadata?: GenerateStoreMetadata
  ): Promise<GenerateAndStoreResult> {
    const language = this.getLanguageOrThrow(input.language);
    const category = this.getCategoryOrThrow(input.categoryId);

    const requestPayload: Record<string, string> = {
      topic: input.topic,
      query: input.query,
      max_tokens: "512",
      use_cache: "true",
      language
    };

    if (input.numQuestions) {
      requestPayload.num_questions = String(input.numQuestions);
    }
    if (typeof input.difficultyPercentage === "number") {
      requestPayload.difficulty_percentage = String(input.difficultyPercentage);
    }
    if (input.letters) {
      requestPayload.letters = input.letters;
    }

    const topicKey = this.normalizeTopicKey(input.topic, language);
    if (topicKey) {
      const existingTopic = await prisma.gameGeneration.findFirst({
        where: {
          gameType: "word-pass",
          topicKey
        },
        select: { id: true }
      });
      if (existingTopic) {
        this.observer?.onModelDuplicate?.("topic");
        return {
          stored: false,
          duplicateReason: "topic",
          responsePayload: { duplicate: true, reason: "topic" }
        };
      }
    }

    this.ensureAiAuthCircuitClosed();

    let responsePayload: unknown;
    try {
      responsePayload = await this.client.generate(requestPayload);
      this.registerAiAuthSuccess();
    } catch (error) {
      this.registerAiAuthFailure(error);
      this.observer?.onModelFailed?.();
      throw error;
    }

    const uniquenessKey = this.buildUniquenessKey("word-pass", responsePayload, language);

    const existingContent = await prisma.gameGeneration.findFirst({
      where: { uniquenessKey },
      select: { id: true }
    });
    if (existingContent) {
      this.observer?.onModelDuplicate?.("content");
      return {
        stored: false,
        duplicateReason: "content",
        responsePayload
      };
    }

    try {
      await prisma.gameGeneration.create({
        data: {
          gameType: "word-pass",
          topic: input.topic,
          topicKey,
          query: input.query,
          language,
          status: "created",
          categoryId: metadata?.category?.id ?? category.id,
          categoryName: metadata?.category?.name ?? category.name,
          uniquenessKey,
          batchRunId: metadata?.batchRunId,
          requestJson: JSON.stringify(requestPayload),
          responseJson: JSON.stringify(responsePayload)
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        this.observer?.onModelDuplicate?.("content");
        return {
          stored: false,
          duplicateReason: "content",
          responsePayload
        };
      }
      this.observer?.onModelFailed?.();
      throw error;
    }

    this.observer?.onModelStored?.();

    return {
      stored: true,
      responsePayload
    };
  }

  private buildDimensionMatrix(): Array<{ language: string; category: { id: string; name: string } }> {
    const languageCodes = this.languages.map((item) => item.code);
    return languageCodes.flatMap((language) =>
      this.categories.map((category) => ({ language, category }))
    );
  }

  private mapStoredModel(item: {
    id: string;
    gameType: string;
    topic: string;
    query: string;
    language: string;
    status: string;
    categoryId: string | null;
    categoryName: string | null;
    requestJson: string;
    responseJson: string;
    createdAt: Date;
  }): StoredGameModel {
    return {
      id: item.id,
      gameType: item.gameType,
      topic: item.topic,
      query: item.query,
      language: item.language,
      status: item.status,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      request: this.parseJson(item.requestJson),
      response: this.parseJson(item.responseJson),
      createdAt: item.createdAt
    };
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private normalizeManualContent(content: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(content).filter(([, value]) => value !== null && value !== undefined);
    if (entries.length === 0) {
      throw new Error("Invalid content payload");
    }

    const compact = Object.fromEntries(entries);
    const serialized = this.stableStringify(compact);
    if (serialized.length < 8) {
      throw new Error("Invalid content payload");
    }

    return compact;
  }

  private normalizeTopicKey(topic: string, language: string): string {
    const normalized = topic
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${language.toLowerCase()}|${normalized}`;
  }

  private buildUniquenessKey(gameType: string, payload: unknown, language: string): string {
    const stablePayload = this.stableStringify(payload);
    return createHash("sha256")
      .update(`${gameType}|${language.toLowerCase()}|${stablePayload}`)
      .digest("hex");
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const body = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
      .join(",");
    return `{${body}}`;
  }

  private getCategoryOrThrow(categoryId: string): { id: string; name: string } {
    const category = this.categoryById.get(categoryId);
    if (!category) {
      throw new Error(`Unsupported categoryId: ${categoryId}`);
    }
    return category;
  }

  private getLanguageOrThrow(language: string): string {
    const normalized = language.toLowerCase();
    if (!this.languageByCode.has(normalized)) {
      throw new Error(`Unsupported language: ${language}`);
    }
    return normalized;
  }

  private ensureAiAuthCircuitClosed(): void {
    if (this.aiAuthCircuitOpenedUntilMs <= 0) {
      return;
    }

    if (Date.now() >= this.aiAuthCircuitOpenedUntilMs) {
      this.aiAuthCircuitOpenedUntilMs = 0;
      this.aiAuthFailureStreak = 0;
      this.emitAiAuthCircuitState();
      return;
    }

    throw new Error(
      `AI auth circuit open until ${new Date(this.aiAuthCircuitOpenedUntilMs).toISOString()}`
    );
  }

  private registerAiAuthSuccess(): void {
    const hasChanges = this.aiAuthFailureStreak > 0 || this.aiAuthCircuitOpenedUntilMs > 0;
    this.aiAuthFailureStreak = 0;
    this.aiAuthCircuitOpenedUntilMs = 0;
    if (hasChanges) {
      this.emitAiAuthCircuitState();
    }
  }

  private registerAiAuthFailure(error: unknown): void {
    const statusCode = this.extractAiEngineStatusCode(error);
    if (statusCode !== 401 && statusCode !== 403) {
      return;
    }

    this.aiAuthFailureStreak += 1;
    if (this.aiAuthFailureStreak >= this.aiAuthFailureThreshold) {
      this.aiAuthCircuitOpenedUntilMs = Date.now() + this.aiAuthCircuitCooldownMs;
      this.aiAuthCircuitOpenedTotal += 1;
    }
    this.emitAiAuthCircuitState();
  }

  private emitAiAuthCircuitState(): void {
    this.observer?.onAiAuthCircuitStateChanged?.(this.getAiAuthCircuitSnapshot());
  }

  private extractAiEngineStatusCode(error: unknown): number | null {
    if (!(error instanceof Error)) {
      return null;
    }

    const match = error.message.match(/ai-engine error\s+(\d{3})/i);
    if (!match) {
      return null;
    }

    const statusCode = Number(match[1]);
    return Number.isFinite(statusCode) ? statusCode : null;
  }

  private isAiAuthCircuitOpenError(error: unknown): boolean {
    return error instanceof Error && /ai auth circuit open/i.test(error.message);
  }
}
