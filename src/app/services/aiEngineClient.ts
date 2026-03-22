import { AppConfig } from "../config.js";

export interface OutboundRequestMetric {
  operation: "generate" | "ingest" | "catalogs";
  statusCode: number;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
  success: boolean;
}

export interface AiEngineClientObserver {
  onOutboundRequest: (metric: OutboundRequestMetric) => void;
}

export interface IngestDocumentInput {
  content: string;
  docId?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResponse {
  ingested: number;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogLanguage {
  code: string;
  name: string;
}

export interface CatalogsResponse {
  categories: CatalogCategory[];
  languages: CatalogLanguage[];
}

export class AiEngineClient {
  constructor(
    private readonly config: AppConfig,
    private readonly observer?: AiEngineClientObserver
  ) {}

  async generate(params: Record<string, string>): Promise<unknown> {
    const endpoint = `${this.config.AI_ENGINE_BASE_URL}${this.config.AI_ENGINE_GENERATION_ENDPOINT}`;
    const url = new URL(endpoint);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });

    return this.requestJson(url.toString(), {
      method: "POST",
      headers: this.buildHeaders(this.config.AI_ENGINE_API_KEY)
    });
  }

  async ingest(documents: IngestDocumentInput[], source?: string): Promise<IngestResponse> {
    const endpoint = `${this.config.AI_ENGINE_BASE_URL}${this.config.AI_ENGINE_INGEST_ENDPOINT}`;
    const headers = this.buildHeaders(
      this.config.AI_ENGINE_INGEST_API_KEY ?? this.config.AI_ENGINE_API_KEY,
      {
      "Content-Type": "application/json",
      ...(source ? { "X-Ingest-Source": source } : {})
      }
    );

    const payload = {
      documents: documents.map((document) => ({
        content: document.content,
        ...(document.docId ? { doc_id: document.docId } : {}),
        ...(document.metadata ? { metadata: document.metadata } : {})
      }))
    };

    const data = await this.requestJson(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    }, "ingest");

    if (
      typeof data === "object" &&
      data !== null &&
      "ingested" in data &&
      typeof data.ingested === "number"
    ) {
      return { ingested: data.ingested };
    }

    throw new Error(`ai-engine ingest error: unexpected response ${JSON.stringify(data)}`);
  }

  async getCatalogs(): Promise<CatalogsResponse> {
    const endpoint = `${this.config.AI_ENGINE_BASE_URL}${this.config.AI_ENGINE_CATALOGS_ENDPOINT}`;
    const data = await this.requestJson(
      endpoint,
      {
        method: "GET",
        headers: this.buildHeaders(this.config.AI_ENGINE_API_KEY)
      },
      "catalogs"
    );

    if (
      typeof data === "object" &&
      data !== null &&
      Array.isArray((data as { categories?: unknown[] }).categories) &&
      Array.isArray((data as { languages?: unknown[] }).languages)
    ) {
      const categories = ((data as { categories: unknown[] }).categories ?? [])
        .filter(
          (item): item is CatalogCategory =>
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            typeof item.id === "string" &&
            "name" in item &&
            typeof item.name === "string"
        );
      const languages = ((data as { languages: unknown[] }).languages ?? [])
        .filter(
          (item): item is CatalogLanguage =>
            typeof item === "object" &&
            item !== null &&
            "code" in item &&
            typeof item.code === "string" &&
            "name" in item &&
            typeof item.name === "string"
        );

      if (categories.length > 0 && languages.length > 0) {
        return { categories, languages };
      }
    }

    throw new Error(`ai-engine catalogs error: unexpected response ${JSON.stringify(data)}`);
  }

  private buildHeaders(
    apiKey?: string,
    extraHeaders?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...(extraHeaders ?? {})
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return headers;
  }

  private async requestJson(
    url: string,
    requestInit: RequestInit,
    operation: OutboundRequestMetric["operation"] = "generate"
  ): Promise<unknown> {
    const startedAt = Date.now();
    const requestBytes =
      typeof requestInit.body === "string" ? Buffer.byteLength(requestInit.body, "utf8") : 0;
    const response = await fetch(url, {
      ...requestInit,
      signal: AbortSignal.timeout(this.config.AI_ENGINE_REQUEST_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    const responseText = JSON.stringify(data);
    this.observer?.onOutboundRequest({
      operation,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      requestBytes,
      responseBytes: Buffer.byteLength(responseText, "utf8"),
      success: response.ok
    });

    if (!response.ok) {
      throw new Error(
        `ai-engine error ${response.status}: ${JSON.stringify(data)}`
      );
    }

    return data;
  }
}
