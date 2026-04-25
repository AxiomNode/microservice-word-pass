import { Prisma } from "@prisma/client";
import {
  type AiAuthCircuitState,
  buildCategoryDimensionMatrix,
  buildStoredRequestPayload,
  ensureAiAuthCircuitClosedState,
  extractAiEngineStatusCode as extractAiEngineStatusCodeShared,
  extractDifficultyFromRequest as extractDifficultyFromRequestShared,
  getGameCategoryOrThrow,
  isAiAuthCircuitOpenError as isAiAuthCircuitOpenErrorShared,
  mapStoredHistoryModel as mapStoredHistoryModelShared,
  mapStoredHistoryModels as mapStoredHistoryModelsShared,
  mapStoredModel as mapStoredModelShared,
  mapStoredModelsSafely as mapStoredModelsSafelyShared,
  normalizeContentToken as normalizeContentTokenShared,
  parseStoredJsonSafely as parseStoredJsonSafelyShared,
  registerAiAuthFailureState,
  registerAiAuthSuccessState,
  stableStringify as stableStringifyShared,
  type StoredGameRow,
  validateStoredHistoryPayload as validateStoredHistoryPayloadShared,
} from "@axiomnode/shared-sdk-client";
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
  GAME_CATEGORIES,
  GAME_CATEGORY_BY_ID,
  GameCategory
} from "./triviaCategories.js";

/** @module generationService - Core service for AI-driven word-pass model generation, storage, and retrieval. */

/** Snapshot of the currently loaded category catalog (English-only stack). */
export interface CatalogSnapshot {
  source: "local-fallback" | "ai-engine";
  categories: { id: string; name: string }[];
  updatedAt: string;
}

/** State of the AI authentication circuit breaker. */
export interface AiAuthCircuitSnapshot {
  open: boolean;
  failureStreak: number;
  failureThreshold: number;
  openedUntil?: string;
  cooldownMs: number;
  openedTotal: number;
}

/** Observer callbacks for lifecycle events emitted by the GenerationService. */
export interface GenerationServiceObserver {
  onModelStored?: () => void;
  onModelDuplicate?: (reason: "content") => void;
  onModelFailed?: () => void;
  onAiAuthCircuitStateChanged?: (state: AiAuthCircuitSnapshot) => void;
  onProcessStarted?: (payload: { taskId: string; requested: number }) => void;
  onProcessCompleted?: (snapshot: GenerationProcessSnapshot) => void;
  onBatchCompleted?: (result: BatchGenerationResult) => void;
  onOutboundRequest?: AiEngineClientObserver["onOutboundRequest"];
}

/** Input parameters for a single AI generation request. */
export interface GenerateInput {
  categoryId: string;
  difficultyPercentage?: number;
  itemCount?: number;
  numQuestions?: number;
  letters?: string;
  requestedBy?: "api" | "backoffice";
}

/** Input parameters for manually creating a game model from the backoffice. */
export interface ManualModelInput {
  categoryId: string;
  difficultyPercentage: number;
  content: Record<string, unknown>;
  status?: "manual" | "validated" | "pending_review";
}

export interface ManualModelUpdateInput {
  categoryId?: string;
  difficultyPercentage?: number;
  content?: Record<string, unknown>;
  status?: "manual" | "validated" | "pending_review";
}

/** Input parameters for a multi-item generation process. */
export interface GenerationProcessInput extends GenerateInput {
  count: number;
}

/** Progress and result snapshot of an ongoing or completed generation process. */
export interface GenerationProcessSnapshot {
  taskId: string;
  requestedBy: "api" | "backoffice";
  status: "running" | "completed" | "failed";
  requested: number;
  processed: number;
  created: number;
  duplicates: number;
  duplicateReasons: {
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
  query: string;
}

/** Filters for retrieving random stored game models. */
export interface RandomModelsFilters {
  count: number;
  categoryId?: string;
  difficultyPercentage?: number;
  status?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

/** Filters for querying model generation history. */
export interface HistoryFilters {
  categoryId?: string;
  difficultyPercentage?: number;
  status?: string;
}

export interface HistoryPageResult {
  items: StoredGameModel[];
  total: number;
  page: number;
  pageSize: number;
}

/** Aggregated model counts grouped by category. */
export interface GroupedModelsSummary {
  categories: Array<{ categoryId: string; categoryName: string; total: number }>;
  matrix: Array<{ categoryId: string; categoryName: string; total: number }>;
}

/** Summary result of a periodic batch generation run. */
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
  duplicateReason?: "content";
  responsePayload: unknown;
}

interface GenerateStoreMetadata {
  category?: GameCategory;
  batchRunId?: string;
}

interface StoredGameModel {
  id: string;
  gameType: string;
  query: string;
  status: string;
  categoryId: string | null;
  categoryName: string | null;
  request: unknown;
  response: unknown;
  responseValidationError?: string;
  createdAt: Date;
}

interface GenerationProcessTask {
  taskId: string;
  requestedBy: "api" | "backoffice";
  status: "running" | "completed" | "failed";
  requested: number;
  processed: number;
  created: number;
  duplicates: number;
  duplicateByContent: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  generatedItems: unknown[];
  errors: string[];
}

const PROMPT_VARIANTS = [
  "fundamentals",
  "curiosities",
  "key figures",
  "historical events",
  "essential concepts",
  "little known facts",
  "recent milestones",
  "global context",
  "cultural impact",
  "innovations",
  "practical applications",
  "current challenges",
  "classics",
  "international perspective",
  "surprising data",
  "influential figures"
];

const CONTEXT_FRAMES = [
  "introduction",
  "intermediate level",
  "advanced level",
  "historical comparison",
  "modern approach",
  "emblematic cases",
  "educational focus",
  "interdisciplinary view"
];

const LETTER_SETS = [
  "A,B,C,D,E,F,G,H,I,J,L,M,N,O,P,R,S,T,V,Z",
  "A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z",
  "A,C,E,G,I,K,L,M,N,O,P,R,S,T,U,V"
];

/** Core service: generates word-pass models via AI, stores them, and manages catalogs and processes. */
export class GenerationService {
  private readonly client: AiEngineClient;
  private readonly generationProcesses = new Map<string, GenerationProcessTask>();
  private readonly generationProcessRetentionLimit = 200;
  private readonly aiAuthFailureThreshold: number;
  private readonly aiAuthCircuitCooldownMs: number;
  private aiAuthFailureStreak = 0;
  private aiAuthCircuitOpenedUntilMs = 0;
  private aiAuthCircuitOpenedTotal = 0;
  private categories: { id: string; name: string }[] = [...GAME_CATEGORIES];
  private categoryById = new Map(GAME_CATEGORY_BY_ID);
  private catalogSource: CatalogSnapshot["source"] = "local-fallback";
  private catalogUpdatedAt = new Date().toISOString();
  private groupedSummaryCache: { data: GroupedModelsSummary; expiresAt: number } | null = null;
  private static readonly GROUPED_SUMMARY_TTL_MS = 60_000;

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
      this.categoryById = new Map(payload.categories.map((item) => [item.id, item] as const));
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
      updatedAt: this.catalogUpdatedAt
    };
  }

  async generateAndStore(input: GenerateInput): Promise<unknown> {
    const category = this.getCategoryOrThrow(input.categoryId);
    const itemCount = this.resolveRequestedItemCount(input);

    const resolved = this.buildResolvedInput(Math.floor(Math.random() * 10_000), category);
    const result = await this.generateAndStoreWithResult({
      ...resolved,
      difficultyPercentage: input.difficultyPercentage,
      itemCount
    });

    return result.responsePayload;
  }

  async storeManualModel(input: ManualModelInput): Promise<StoredGameModel> {
    const category = this.getCategoryOrThrow(input.categoryId);
    const difficulty = Math.max(0, Math.min(100, Math.trunc(input.difficultyPercentage)));

    const normalizedContent = this.normalizeManualContent(input.content);
    const query = this.buildPrimaryWordpassText(
      normalizedContent,
      `${category.name} difficulty ${difficulty}`,
    );
    const uniquenessKey = this.buildUniquenessKey("word-pass", normalizedContent);

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
        query,
        status: input.status ?? "manual",
        categoryId: category.id,
        categoryName: category.name,
        uniquenessKey,
        difficultyPercentage: difficulty,
        requestJson: JSON.stringify({
          source: "backoffice-manual",
          categoryId: category.id,
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

  async updateHistoryItem(id: string, input: ManualModelUpdateInput): Promise<StoredGameModel | null> {
    const existing = await prisma.gameGeneration.findFirst({
      where: { id, gameType: "word-pass" },
      select: GenerationService.storedModelSelect,
    });

    if (!existing) {
      return null;
    }

    const nextCategoryId = input.categoryId ?? existing.categoryId ?? undefined;
    const nextDifficulty = typeof input.difficultyPercentage === "number"
      ? Math.max(0, Math.min(100, Math.trunc(input.difficultyPercentage)))
      : existing.difficultyPercentage ?? this.extractDifficultyFromRequest(this.parseJson(existing.requestJson));

    if (!nextCategoryId) {
      throw new Error("Category is required");
    }

    const category = this.getCategoryOrThrow(nextCategoryId);
    const currentResponse = this.parseJson(existing.responseJson) as Record<string, unknown>;
    const normalizedContent = input.content
      ? this.normalizeManualContent(input.content)
      : this.normalizeManualContent(currentResponse);
    const query = this.buildPrimaryWordpassText(
      normalizedContent,
      `${category.name} difficulty ${nextDifficulty}`,
    );
    const uniquenessKey = this.buildUniquenessKey("word-pass", normalizedContent);

    const duplicate = await prisma.gameGeneration.findFirst({
      where: {
        uniquenessKey,
        NOT: { id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new Error("Duplicate content");
    }

    const updated = await prisma.gameGeneration.update({
      where: { id },
      data: {
        query,
        status: input.status ?? existing.status,
        categoryId: category.id,
        categoryName: category.name,
        uniquenessKey,
        difficultyPercentage: nextDifficulty,
        requestJson: JSON.stringify({
          source: "backoffice-manual",
          categoryId: category.id,
          difficulty_percentage: nextDifficulty,
        }),
        responseJson: JSON.stringify(normalizedContent),
      },
      select: GenerationService.storedModelSelect,
    });

    return this.mapStoredModel(updated);
  }

  startGenerationProcess(input: GenerationProcessInput): GenerationProcessSnapshot {
    const task: GenerationProcessTask = {
      taskId: randomUUID(),
      requestedBy: input.requestedBy === "backoffice" ? "backoffice" : "api",
      status: "running",
      requested: input.count,
      processed: 0,
      created: 0,
      duplicates: 0,
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

  async runGenerationProcessBlocking(input: GenerationProcessInput): Promise<GenerationProcessSnapshot> {
    const task: GenerationProcessTask = {
      taskId: randomUUID(),
      requestedBy: input.requestedBy === "backoffice" ? "backoffice" : "api",
      status: "running",
      requested: input.count,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: undefined,
      generatedItems: [],
      errors: []
    };

    this.generationProcesses.set(task.taskId, task);
    this.pruneGenerationProcesses();
    this.observer?.onProcessStarted?.({ taskId: task.taskId, requested: task.requested });

    await this.runGenerationProcess(task.taskId, input);

    const latest = this.generationProcesses.get(task.taskId) ?? task;
    return this.toGenerationProcessSnapshot(latest, true);
  }

  getGenerationProcess(taskId: string, includeItems = false): GenerationProcessSnapshot | null {
    const task = this.generationProcesses.get(taskId);
    if (!task) {
      return null;
    }
    return this.toGenerationProcessSnapshot(task, includeItems);
  }

  listGenerationProcesses(options?: {
    limit?: number;
    status?: "running" | "completed" | "failed";
    requestedBy?: "api" | "backoffice";
  }): GenerationProcessSnapshot[] {
    const limit = options?.limit ?? 20;
    return [...this.generationProcesses.values()]
      .filter((task) => {
        if (options?.status && task.status !== options.status) {
          return false;
        }
        if (options?.requestedBy && task.requestedBy !== options.requestedBy) {
          return false;
        }
        return true;
      })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(1, limit))
        .map((task) => this.toGenerationProcessSnapshot(task, false));
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
          const candidateInput = this.buildResolvedInput(attemptNumber, selection.category);

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

  private static readonly storedModelSelect = {
    id: true,
    gameType: true,
    query: true,
    status: true,
    categoryId: true,
    categoryName: true,
    difficultyPercentage: true,
    requestJson: true,
    responseJson: true,
    createdAt: true,
  } as const;

  async randomModels(filters: RandomModelsFilters): Promise<StoredGameModel[]> {
    const where: Prisma.GameGenerationWhereInput = {
      gameType: "word-pass",
      ...(filters.status ? {} : { status: { not: "pending_review" } }),
    };

    if (filters.categoryId) {
      where.categoryId = this.getCategoryOrThrow(filters.categoryId).id;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (typeof filters.difficultyPercentage === "number") {
      where.difficultyPercentage = Math.max(0, Math.min(100, Math.trunc(filters.difficultyPercentage)));
    }
    if (filters.createdAfter || filters.createdBefore) {
      where.createdAt = {
        ...(filters.createdAfter ? { gte: filters.createdAfter } : {}),
        ...(filters.createdBefore ? { lte: filters.createdBefore } : {})
      };
    }

    const poolSize = Math.min(1000, Math.max(filters.count * 30, 300));

    const candidates = await prisma.gameGeneration.findMany({
      where,
      select: GenerationService.storedModelSelect,
      orderBy: { createdAt: "desc" },
      take: poolSize
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
    return this.mapStoredModelsSafely(selected).slice(0, filters.count);
  }

  async groupedModelsSummary(): Promise<GroupedModelsSummary> {
    if (this.groupedSummaryCache && Date.now() < this.groupedSummaryCache.expiresAt) {
      return this.groupedSummaryCache.data;
    }

    const rows = await prisma.gameGeneration.groupBy({
      by: ["categoryId", "categoryName"],
      where: { gameType: "word-pass" },
      _count: { _all: true }
    });

    const matrix = rows
      .filter((row) => row.categoryId && row.categoryName)
      .map((row) => ({
        categoryId: row.categoryId as string,
        categoryName: row.categoryName as string,
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

    const result: GroupedModelsSummary = {
      categories,
      matrix
    };

    this.groupedSummaryCache = {
      data: result,
      expiresAt: Date.now() + GenerationService.GROUPED_SUMMARY_TTL_MS,
    };

    return result;
  }

  async history(limit = 20, filters?: HistoryFilters): Promise<StoredGameModel[]> {
    const normalizedLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const rows = await prisma.gameGeneration.findMany({
      where: {
        gameType: "word-pass",
        ...(filters?.categoryId ? { categoryId: this.getCategoryOrThrow(filters.categoryId).id } : {}),
        ...(typeof filters?.difficultyPercentage === "number"
          ? { difficultyPercentage: Math.max(0, Math.min(100, Math.trunc(filters.difficultyPercentage))) }
          : {}),
      },
      select: GenerationService.storedModelSelect,
      orderBy: { createdAt: "desc" },
      take: normalizedLimit
    });

    return this.mapStoredHistoryModels(rows).slice(0, normalizedLimit);
  }

  async historyPage(limit = 20, options?: HistoryFilters & { page?: number; pageSize?: number }): Promise<HistoryPageResult> {
    const normalizedLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const normalizedPage = Math.max(1, Math.trunc(options?.page ?? 1));
    const normalizedPageSize = Math.max(1, Math.min(200, Math.trunc(options?.pageSize ?? Math.min(20, normalizedLimit))));
    const skip = (normalizedPage - 1) * normalizedPageSize;
    const where = {
      gameType: "word-pass",
      ...(options?.categoryId ? { categoryId: this.getCategoryOrThrow(options.categoryId).id } : {}),
      ...(options?.status ? { status: options.status } : {}),
      ...(typeof options?.difficultyPercentage === "number"
        ? { difficultyPercentage: Math.max(0, Math.min(100, Math.trunc(options.difficultyPercentage))) }
        : {}),
    } as const;

    const [total, rows] = await Promise.all([
      prisma.gameGeneration.count({ where }),
      prisma.gameGeneration.findMany({
        where,
        select: GenerationService.storedModelSelect,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedPageSize,
      }),
    ]);

    return {
      items: this.mapStoredHistoryModels(rows),
      total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
    };
  }

  private async runGenerationProcess(taskId: string, input: GenerationProcessInput): Promise<void> {
    const task = this.generationProcesses.get(taskId);
    if (!task) {
      return;
    }

    try {
      const category = this.getCategoryOrThrow(input.categoryId);
      const concurrency = Math.min(3, input.count);

      const processOne = async (index: number): Promise<void> => {
        const resolved = this.buildResolvedInput(index, category);
        const itemCount = this.resolveRequestedItemCount(input) ?? resolved.numQuestions;
        const payload: ResolvedGenerateInput = {
          ...resolved,
          difficultyPercentage: input.difficultyPercentage ?? resolved.difficultyPercentage,
          itemCount
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

        task.processed += 1;
        task.updatedAt = new Date().toISOString();
      };

      for (let batchStart = 0; batchStart < input.count; batchStart += concurrency) {
        const batchEnd = Math.min(batchStart + concurrency, input.count);
        const batch = [];
        for (let i = batchStart; i < batchEnd; i++) {
          batch.push(processOne(i));
        }
        await Promise.allSettled(batch);
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
      requestedBy: task.requestedBy,
      status: task.status,
      requested: task.requested,
      processed: task.processed,
      created: task.created,
      duplicates: task.duplicates,
      duplicateReasons: {
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
      ...(includeItems ? { generatedItems: task.generatedItems } : {}),
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
    category: { id: string; name: string }
  ): ResolvedGenerateInput {
    const categoryCount = this.categories.length;
    const variant = PROMPT_VARIANTS[Math.floor(attempt / categoryCount) % PROMPT_VARIANTS.length];
    const frame =
      CONTEXT_FRAMES[
        Math.floor(attempt / (categoryCount * PROMPT_VARIANTS.length)) % CONTEXT_FRAMES.length
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
      difficultyPercentage: difficulty,
      numQuestions,
      letters,
      query: `${category.name} ${variant} ${frame} word-pass avoid ambiguous or nonsensical answers`
    };
  }

  private pickRange(min: number, max: number): number {
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
  }

  private resolveRequestedItemCount(input: { itemCount?: number; numQuestions?: number }): number | undefined {
    return input.itemCount ?? input.numQuestions;
  }

  private async generateAndStoreWithResult(
    input: ResolvedGenerateInput,
    metadata?: GenerateStoreMetadata
  ): Promise<GenerateAndStoreResult> {
    const category = this.getCategoryOrThrow(input.categoryId);

    const requestPayload: Record<string, string> = {
      query: input.query,
      max_tokens: "1024",
      use_cache: "true"
    };

    if (input.itemCount) {
      requestPayload.item_count = String(input.itemCount);
    }
    if (typeof input.difficultyPercentage === "number") {
      requestPayload.difficulty_percentage = String(input.difficultyPercentage);
    }
    if (input.letters) {
      requestPayload.letters = input.letters;
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

    const sanitizedResponsePayload = this.sanitizeGeneratedPayload(responsePayload);
    const uniquenessKey = this.buildUniquenessKey("word-pass", sanitizedResponsePayload);

    const existingContent = await prisma.gameGeneration.findFirst({
      where: { uniquenessKey },
      select: { id: true }
    });
    if (existingContent) {
      this.observer?.onModelDuplicate?.("content");
      return {
        stored: false,
        duplicateReason: "content",
            responsePayload: sanitizedResponsePayload
      };
    }

    const requestPayloadForStorage = buildStoredRequestPayload(requestPayload, category);
    const storedDifficulty = this.extractDifficultyFromRequest(requestPayloadForStorage);
    const query = this.buildPrimaryWordpassText(
      sanitizedResponsePayload,
      input.query,
    );

    try {
      await prisma.gameGeneration.create({
        data: {
          gameType: "word-pass",
          query,
          status: "created",
          categoryId: metadata?.category?.id ?? category.id,
          categoryName: metadata?.category?.name ?? category.name,
          uniquenessKey,
          batchRunId: metadata?.batchRunId,
          difficultyPercentage: storedDifficulty,
          requestJson: JSON.stringify(requestPayloadForStorage),
          responseJson: JSON.stringify(sanitizedResponsePayload)
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        this.observer?.onModelDuplicate?.("content");
        return {
          stored: false,
          duplicateReason: "content",
          responsePayload: sanitizedResponsePayload
        };
      }
      this.observer?.onModelFailed?.();
      throw error;
    }

    this.observer?.onModelStored?.();

    return {
      stored: true,
      responsePayload: sanitizedResponsePayload
    };
  }

  private buildDimensionMatrix(): Array<{ category: { id: string; name: string } }> {
    return buildCategoryDimensionMatrix(this.categories);
  }

  private mapStoredModel(item: StoredGameRow): StoredGameModel {
    return mapStoredModelShared<StoredGameModel>(
      item,
      (value) => this.parseJson(value),
      (payload) => this.sanitizeGeneratedPayload(payload),
    );
  }

  private mapStoredHistoryModel(item: StoredGameRow): StoredGameModel {
    return mapStoredHistoryModelShared<StoredGameModel>(
      item,
      "word-pass",
      (value) => this.parseStoredJsonSafely(value),
      (payload, itemId, gameLabel) => this.validateStoredHistoryPayload(payload, itemId, gameLabel),
    );
  }

  private mapStoredModelsSafely(items: StoredGameRow[]): StoredGameModel[] {
    return mapStoredModelsSafelyShared(
      items,
      "Skipping invalid stored word-pass model",
      (item) => this.mapStoredModel(item),
    );
  }

  private mapStoredHistoryModels(items: StoredGameRow[]): StoredGameModel[] {
    return mapStoredHistoryModelsShared(items, (item) => this.mapStoredHistoryModel(item));
  }

  private parseStoredJsonSafely(value: string): { value: unknown } {
    return parseStoredJsonSafelyShared((input) => this.parseJson(input), value);
  }

  private validateStoredHistoryPayload(payload: unknown, itemId: string, gameLabel: string): string | undefined {
    return validateStoredHistoryPayloadShared(
      payload,
      itemId,
      gameLabel,
      (input) => this.sanitizeGeneratedPayload(input),
    );
  }

  private buildPrimaryWordpassText(payload: unknown, fallback: string): string {
    const hints = this.extractStringArrayFromObjects(payload, "words", "hint")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const preferredHint = hints.find((item) => !this.isGenericWordpassHint(item))
      ?? hints[0];

    if (preferredHint) {
      return preferredHint.slice(0, 240);
    }

    const answers = this.extractStringArrayFromObjects(payload, "words", "answer")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (answers.length > 0) {
      return `Definition of ${answers[0]}`.slice(0, 240);
    }

    const normalizedFallback = fallback.trim();
    return normalizedFallback.length > 0 ? normalizedFallback.slice(0, 240) : "word-pass";
  }

  private isGenericWordpassHint(hint: string): boolean {
    const normalized = hint
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    return normalized.includes("frequent real word")
      || normalized.includes("frequencywords")
      || normalized.includes("word frequency")
      || normalized.includes("frequent term");
  }

  private sanitizeGeneratedPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== "object") {
      throw new Error("Generated payload is not a valid object");
    }
    const obj = payload as Record<string, unknown>;
    const game = (obj.game ?? obj) as Record<string, unknown>;
    const words = game.words;
    if (!Array.isArray(words) || words.length === 0) {
      throw new Error("Generated word-pass has no words — rejecting incomplete content");
    }
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as Record<string, unknown>;
      if (!w.letter || typeof w.letter !== "string") {
        throw new Error(`Word ${i} is missing the 'letter' field`);
      }
      if (!w.hint || typeof w.hint !== "string") {
        throw new Error(`Word ${i} is missing the 'hint' field`);
      }
      if (!w.answer || typeof w.answer !== "string") {
        throw new Error(`Word ${i} is missing the 'answer' field`);
      }
    }
    return payload;
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

  private buildUniquenessKey(gameType: string, payload: unknown): string {
    const primarySignature = this.extractPrimaryContentSignature(gameType, payload);
    const stablePayload = primarySignature
      ? `primary:${primarySignature}`
      : this.stableStringify(payload);
    return createHash("sha256")
      .update(`${gameType}|${stablePayload}`)
      .digest("hex");
  }

  private extractPrimaryContentSignature(gameType: string, payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (gameType === "quiz") {
      const rawQuestions = this.extractStringArrayFromObjects(payload, "questions", "question");
      if (rawQuestions.length === 0) {
        return null;
      }
      return rawQuestions
        .map((item) => this.normalizeContentToken(item))
        .filter((item) => item.length > 0)
        .join("|");
    }

    const words = this.extractStringArrayFromObjects(payload, "words", "answer");
    if (words.length === 0) {
      return null;
    }
    return words
      .map((item) => this.normalizeContentToken(item))
      .filter((item) => item.length > 0)
      .sort()
      .join("|");
  }

  private extractStringArrayFromObjects(payload: unknown, arrayKey: string, fieldKey: string): string[] {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const asRecord = payload as Record<string, unknown>;
    let candidate = asRecord[arrayKey];
    if (!Array.isArray(candidate)) {
      const nestedGame = asRecord.game;
      if (nestedGame && typeof nestedGame === "object") {
        candidate = (nestedGame as Record<string, unknown>)[arrayKey];
      }
    }
    if (!Array.isArray(candidate)) {
      return [];
    }

    return candidate
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const value = (item as Record<string, unknown>)[fieldKey];
        return typeof value === "string" ? value : "";
      })
      .filter((item) => item.trim().length > 0);
  }

  private normalizeContentToken(value: string): string {
    return normalizeContentTokenShared(value);
  }

  private extractDifficultyFromRequest(requestPayload: unknown): number | undefined {
    return extractDifficultyFromRequestShared(requestPayload);
  }

  private stableStringify(value: unknown): string {
    return stableStringifyShared(value);
  }

  private getCategoryOrThrow(categoryId: string): { id: string; name: string } {
    return getGameCategoryOrThrow(this.categoryById, categoryId);
  }

  private ensureAiAuthCircuitClosed(): void {
    const check = ensureAiAuthCircuitClosedState(this.getAiAuthCircuitState(), Date.now());
    this.applyAiAuthCircuitState(check.state);
    if (check.shouldEmit) {
      this.emitAiAuthCircuitState();
      return;
    }

    if (check.blockedUntilMs === null) {
      return;
    }

    throw new Error(
      `AI auth circuit open until ${new Date(check.blockedUntilMs).toISOString()}`
    );
  }

  private registerAiAuthSuccess(): void {
    const transition = registerAiAuthSuccessState(this.getAiAuthCircuitState());
    this.applyAiAuthCircuitState(transition.state);
    if (transition.shouldEmit) {
      this.emitAiAuthCircuitState();
    }
  }

  private registerAiAuthFailure(error: unknown): void {
    const transition = registerAiAuthFailureState(this.getAiAuthCircuitState(), {
      statusCode: this.extractAiEngineStatusCode(error),
      failureThreshold: this.aiAuthFailureThreshold,
      cooldownMs: this.aiAuthCircuitCooldownMs,
      nowMs: Date.now(),
    });
    this.applyAiAuthCircuitState(transition.state);
    if (transition.shouldEmit) {
      this.emitAiAuthCircuitState();
    }
  }

  private emitAiAuthCircuitState(): void {
    this.observer?.onAiAuthCircuitStateChanged?.(this.getAiAuthCircuitSnapshot());
  }

  private getAiAuthCircuitState(): AiAuthCircuitState {
    return {
      failureStreak: this.aiAuthFailureStreak,
      openedUntilMs: this.aiAuthCircuitOpenedUntilMs,
      openedTotal: this.aiAuthCircuitOpenedTotal,
    };
  }

  private applyAiAuthCircuitState(state: AiAuthCircuitState): void {
    this.aiAuthFailureStreak = state.failureStreak;
    this.aiAuthCircuitOpenedUntilMs = state.openedUntilMs;
    this.aiAuthCircuitOpenedTotal = state.openedTotal;
  }

  private extractAiEngineStatusCode(error: unknown): number | null {
    return extractAiEngineStatusCodeShared(error);
  }

  private isAiAuthCircuitOpenError(error: unknown): boolean {
    return isAiAuthCircuitOpenErrorShared(error);
  }
}
