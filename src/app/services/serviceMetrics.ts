import { AppConfig } from "../config.js";
import { BatchGenerationResult, GenerationProcessSnapshot } from "./generationService.js";
import { OutboundRequestMetric } from "./aiEngineClient.js";

interface LogEvent {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

export class ServiceMetrics {
  private readonly startedAt = Date.now();
  private readonly routeCounters = new Map<string, number>();
  private readonly outboundCounters = new Map<string, number>();
  private readonly logs: LogEvent[] = [];

  private requestsReceivedTotal = 0;
  private outboundRequestsTotal = 0;
  private outboundFailuresTotal = 0;
  private generatedStoredTotal = 0;
  private generatedDuplicateTotal = 0;
  private generatedDuplicateTopicTotal = 0;
  private generatedDuplicateContentTotal = 0;
  private generatedFailedTotal = 0;
  private ingestedDocumentsTotal = 0;
  private batchRunsTotal = 0;
  private batchRequestedTotal = 0;
  private batchAttemptsTotal = 0;
  private batchCreatedTotal = 0;
  private batchDuplicatesTotal = 0;
  private batchFailedTotal = 0;
  private lastBatchRun: BatchGenerationResult | null = null;
  private generationProcessesStartedTotal = 0;
  private generationProcessesFinishedTotal = 0;
  private generationProcessesFailedTotal = 0;
  private generationProcessesRequestedTotal = 0;
  private generationProcessesCreatedTotal = 0;
  private generationProcessesDuplicatesTotal = 0;
  private generationProcessesFailedItemsTotal = 0;
  private generationProcessesDuplicateTopicTotal = 0;
  private generationProcessesDuplicateContentTotal = 0;
  private generationProcessesOnlyDuplicatesTotal = 0;
  private requestBytesInTotal = 0;
  private responseBytesOutTotal = 0;
  private outboundRequestBytesTotal = 0;
  private outboundResponseBytesTotal = 0;

  constructor(private readonly config: AppConfig) {}

  recordIncomingRequest(metric: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
    requestBytes: number;
    responseBytes: number;
  }): void {
    this.requestsReceivedTotal += 1;
    this.requestBytesInTotal += metric.requestBytes;
    this.responseBytesOutTotal += metric.responseBytes;

    const key = `${metric.method}|${metric.route}|${metric.statusCode}`;
    this.routeCounters.set(key, (this.routeCounters.get(key) ?? 0) + 1);

    this.pushLog("info", "incoming_request", {
      ...metric
    });
  }

  recordOutboundRequest(metric: OutboundRequestMetric): void {
    this.outboundRequestsTotal += 1;
    this.outboundRequestBytesTotal += metric.requestBytes;
    this.outboundResponseBytesTotal += metric.responseBytes;
    if (!metric.success) {
      this.outboundFailuresTotal += 1;
    }

    const key = `${metric.operation}|${metric.statusCode}`;
    this.outboundCounters.set(key, (this.outboundCounters.get(key) ?? 0) + 1);
  }

  recordGenerationStored(): void {
    this.generatedStoredTotal += 1;
  }

  recordGenerationDuplicate(reason: "topic" | "content"): void {
    this.generatedDuplicateTotal += 1;
    if (reason === "topic") {
      this.generatedDuplicateTopicTotal += 1;
    }
    if (reason === "content") {
      this.generatedDuplicateContentTotal += 1;
    }

    this.pushLog("info", "generation_duplicate", { reason });
  }

  recordGenerationFailed(): void {
    this.generatedFailedTotal += 1;
  }

  recordIngestedDocuments(total: number): void {
    this.ingestedDocumentsTotal += total;
  }

  recordBatch(result: BatchGenerationResult): void {
    this.batchRunsTotal += 1;
    this.batchRequestedTotal += result.requested;
    this.batchAttemptsTotal += result.attempts;
    this.batchCreatedTotal += result.created;
    this.batchDuplicatesTotal += result.duplicates;
    this.batchFailedTotal += result.failed;
    this.lastBatchRun = result;

    this.generatedStoredTotal += result.created;
    this.generatedDuplicateTotal += result.duplicates;
    this.generatedFailedTotal += result.failed;
    this.pushLog("info", "batch_generation_cycle", {
      ...result
    });
  }

  recordGenerationProcessStarted(requested: number): void {
    this.generationProcessesStartedTotal += 1;
    this.generationProcessesRequestedTotal += requested;
    this.pushLog("info", "generation_process_started", {
      requested
    });
  }

  recordGenerationProcessCompleted(snapshot: GenerationProcessSnapshot): void {
    this.generationProcessesFinishedTotal += 1;
    if (snapshot.status === "failed") {
      this.generationProcessesFailedTotal += 1;
    }
    this.generationProcessesCreatedTotal += snapshot.created;
    this.generationProcessesDuplicatesTotal += snapshot.duplicates;
    this.generationProcessesFailedItemsTotal += snapshot.failed;
    this.generationProcessesDuplicateTopicTotal += snapshot.duplicateReasons.topic;
    this.generationProcessesDuplicateContentTotal += snapshot.duplicateReasons.content;
    if (snapshot.created === 0 && snapshot.duplicates > 0 && snapshot.failed === 0) {
      this.generationProcessesOnlyDuplicatesTotal += 1;
    }

    this.pushLog("info", "generation_process_completed", {
      taskId: snapshot.taskId,
      status: snapshot.status,
      requested: snapshot.requested,
      processed: snapshot.processed,
      created: snapshot.created,
      duplicates: snapshot.duplicates,
      duplicateReasons: snapshot.duplicateReasons,
      failed: snapshot.failed
    });
  }

  recordLog(level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>): void {
    this.pushLog(level, message, context);
  }

  snapshot() {
    const generationAttemptsTotal =
      this.generatedStoredTotal + this.generatedDuplicateTotal + this.generatedFailedTotal;
    const successRatio =
      generationAttemptsTotal > 0 ? this.generatedStoredTotal / generationAttemptsTotal : 0;
    const duplicateRatio =
      generationAttemptsTotal > 0 ? this.generatedDuplicateTotal / generationAttemptsTotal : 0;
    const failureRatio =
      generationAttemptsTotal > 0 ? this.generatedFailedTotal / generationAttemptsTotal : 0;

    return {
      service: this.config.SERVICE_NAME,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      traffic: {
        requestsReceivedTotal: this.requestsReceivedTotal,
        requestBytesInTotal: this.requestBytesInTotal,
        responseBytesOutTotal: this.responseBytesOutTotal,
        outboundRequestsTotal: this.outboundRequestsTotal,
        outboundFailuresTotal: this.outboundFailuresTotal,
        outboundRequestBytesTotal: this.outboundRequestBytesTotal,
        outboundResponseBytesTotal: this.outboundResponseBytesTotal
      },
      generation: {
        generatedStoredTotal: this.generatedStoredTotal,
        generatedDuplicateTotal: this.generatedDuplicateTotal,
        generatedDuplicateTopicTotal: this.generatedDuplicateTopicTotal,
        generatedDuplicateContentTotal: this.generatedDuplicateContentTotal,
        generatedFailedTotal: this.generatedFailedTotal,
        ingestedDocumentsTotal: this.ingestedDocumentsTotal,
        attemptsTotal: generationAttemptsTotal,
        successRatio,
        duplicateRatio,
        failureRatio
      },
      batch: {
        runsTotal: this.batchRunsTotal,
        requestedTotal: this.batchRequestedTotal,
        attemptsTotal: this.batchAttemptsTotal,
        createdTotal: this.batchCreatedTotal,
        duplicatesTotal: this.batchDuplicatesTotal,
        failedTotal: this.batchFailedTotal,
        lastRun: this.lastBatchRun
      },
      processes: {
        startedTotal: this.generationProcessesStartedTotal,
        finishedTotal: this.generationProcessesFinishedTotal,
        failedTotal: this.generationProcessesFailedTotal,
        requestedTotal: this.generationProcessesRequestedTotal,
        createdTotal: this.generationProcessesCreatedTotal,
        duplicatesTotal: this.generationProcessesDuplicatesTotal,
        failedItemsTotal: this.generationProcessesFailedItemsTotal,
        duplicateTopicTotal: this.generationProcessesDuplicateTopicTotal,
        duplicateContentTotal: this.generationProcessesDuplicateContentTotal,
        onlyDuplicatesTotal: this.generationProcessesOnlyDuplicatesTotal
      },
      requestsByRoute: Array.from(this.routeCounters.entries()).map(([key, total]) => {
        const [method, route, statusCode] = key.split("|");
        return {
          method,
          route,
          statusCode: Number(statusCode),
          total
        };
      }),
      outboundByOperation: Array.from(this.outboundCounters.entries()).map(([key, total]) => {
        const [operation, statusCode] = key.split("|");
        return {
          operation,
          statusCode: Number(statusCode),
          total
        };
      })
    };
  }

  recentLogs(limit = 200): LogEvent[] {
    return this.logs.slice(-Math.max(1, limit));
  }

  toPrometheus(): string {
    const lines: string[] = [];
    lines.push("# HELP microservice_requests_received_total Total incoming requests");
    lines.push("# TYPE microservice_requests_received_total counter");
    lines.push(`microservice_requests_received_total ${this.requestsReceivedTotal}`);

    lines.push("# HELP microservice_outbound_requests_total Total outbound requests");
    lines.push("# TYPE microservice_outbound_requests_total counter");
    lines.push(`microservice_outbound_requests_total ${this.outboundRequestsTotal}`);

    lines.push("# HELP microservice_outbound_failures_total Total failed outbound requests");
    lines.push("# TYPE microservice_outbound_failures_total counter");
    lines.push(`microservice_outbound_failures_total ${this.outboundFailuresTotal}`);

    lines.push("# HELP microservice_generated_stored_total Total generated models stored");
    lines.push("# TYPE microservice_generated_stored_total counter");
    lines.push(`microservice_generated_stored_total ${this.generatedStoredTotal}`);

    lines.push("# HELP microservice_generated_duplicate_total Total duplicate generations rejected");
    lines.push("# TYPE microservice_generated_duplicate_total counter");
    lines.push(`microservice_generated_duplicate_total ${this.generatedDuplicateTotal}`);

    lines.push("# HELP microservice_generated_duplicate_topic_total Total duplicate generations rejected by topic");
    lines.push("# TYPE microservice_generated_duplicate_topic_total counter");
    lines.push(`microservice_generated_duplicate_topic_total ${this.generatedDuplicateTopicTotal}`);

    lines.push("# HELP microservice_generated_duplicate_content_total Total duplicate generations rejected by content");
    lines.push("# TYPE microservice_generated_duplicate_content_total counter");
    lines.push(`microservice_generated_duplicate_content_total ${this.generatedDuplicateContentTotal}`);

    lines.push("# HELP microservice_generated_failed_total Total failed generation attempts");
    lines.push("# TYPE microservice_generated_failed_total counter");
    lines.push(`microservice_generated_failed_total ${this.generatedFailedTotal}`);

    lines.push("# HELP microservice_ingested_documents_total Total documents ingested to ai-engine");
    lines.push("# TYPE microservice_ingested_documents_total counter");
    lines.push(`microservice_ingested_documents_total ${this.ingestedDocumentsTotal}`);

    lines.push("# HELP microservice_batch_runs_total Total periodic generation runs");
    lines.push("# TYPE microservice_batch_runs_total counter");
    lines.push(`microservice_batch_runs_total ${this.batchRunsTotal}`);

    lines.push("# HELP microservice_batch_requested_total Total requested items across periodic generation runs");
    lines.push("# TYPE microservice_batch_requested_total counter");
    lines.push(`microservice_batch_requested_total ${this.batchRequestedTotal}`);

    lines.push("# HELP microservice_batch_attempts_total Total attempts across periodic generation runs");
    lines.push("# TYPE microservice_batch_attempts_total counter");
    lines.push(`microservice_batch_attempts_total ${this.batchAttemptsTotal}`);

    lines.push("# HELP microservice_batch_created_total Total items created across periodic generation runs");
    lines.push("# TYPE microservice_batch_created_total counter");
    lines.push(`microservice_batch_created_total ${this.batchCreatedTotal}`);

    lines.push("# HELP microservice_batch_duplicates_total Total duplicates across periodic generation runs");
    lines.push("# TYPE microservice_batch_duplicates_total counter");
    lines.push(`microservice_batch_duplicates_total ${this.batchDuplicatesTotal}`);

    lines.push("# HELP microservice_batch_failed_total Total failed attempts across periodic generation runs");
    lines.push("# TYPE microservice_batch_failed_total counter");
    lines.push(`microservice_batch_failed_total ${this.batchFailedTotal}`);

    lines.push("# HELP microservice_generation_process_started_total Total async generation processes started");
    lines.push("# TYPE microservice_generation_process_started_total counter");
    lines.push(`microservice_generation_process_started_total ${this.generationProcessesStartedTotal}`);

    lines.push("# HELP microservice_generation_process_finished_total Total async generation processes finished");
    lines.push("# TYPE microservice_generation_process_finished_total counter");
    lines.push(`microservice_generation_process_finished_total ${this.generationProcessesFinishedTotal}`);

    lines.push("# HELP microservice_generation_process_failed_total Total async generation processes with final failed status");
    lines.push("# TYPE microservice_generation_process_failed_total counter");
    lines.push(`microservice_generation_process_failed_total ${this.generationProcessesFailedTotal}`);

    lines.push("# HELP microservice_generation_process_only_duplicates_total Total async generation processes completed with only duplicates");
    lines.push("# TYPE microservice_generation_process_only_duplicates_total counter");
    lines.push(`microservice_generation_process_only_duplicates_total ${this.generationProcessesOnlyDuplicatesTotal}`);

    lines.push("# HELP microservice_request_bytes_in_total Total incoming request bytes");
    lines.push("# TYPE microservice_request_bytes_in_total counter");
    lines.push(`microservice_request_bytes_in_total ${this.requestBytesInTotal}`);

    lines.push("# HELP microservice_response_bytes_out_total Total outgoing response bytes");
    lines.push("# TYPE microservice_response_bytes_out_total counter");
    lines.push(`microservice_response_bytes_out_total ${this.responseBytesOutTotal}`);

    lines.push("# HELP microservice_outbound_request_bytes_total Total outbound request bytes");
    lines.push("# TYPE microservice_outbound_request_bytes_total counter");
    lines.push(`microservice_outbound_request_bytes_total ${this.outboundRequestBytesTotal}`);

    lines.push("# HELP microservice_outbound_response_bytes_total Total outbound response bytes");
    lines.push("# TYPE microservice_outbound_response_bytes_total counter");
    lines.push(`microservice_outbound_response_bytes_total ${this.outboundResponseBytesTotal}`);

    return lines.join("\n");
  }

  private pushLog(level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>): void {
    this.logs.push({
      ts: new Date().toISOString(),
      level,
      message,
      context
    });

    const maxSize = this.config.METRICS_LOG_BUFFER_SIZE;
    if (this.logs.length > maxSize) {
      this.logs.splice(0, this.logs.length - maxSize);
    }
  }
}
