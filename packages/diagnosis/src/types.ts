export type DiagnosisConfidence = "low" | "medium" | "high";

export interface FailureConsoleEntry {
  level: "warn" | "error";
  text: string;
  timestamp?: string;
}

export interface FailureRequest {
  url: string;
  method: string;
  status?: number;
  error?: string;
}

export interface ScriptOriginDiff {
  added: string[];
  removed: string[];
}

export interface FailureChangeEvent {
  kind: string;
  detectedAt: string;
  detail: Record<string, unknown>;
}

export interface FailureRunSummary {
  status: "passed" | "failed" | "error";
  startedAt: string;
  failureCode?: string;
}

export interface FailureContext {
  runId: string;
  monitorId: string;
  storeUrl: string;
  productHandle: string;
  failureCode: string;
  failureStep?: string;
  failureMessage?: string;
  consoleErrors: FailureConsoleEntry[];
  failedRequests: FailureRequest[];
  scriptOriginDiff: ScriptOriginDiff;
  recentChanges: FailureChangeEvent[];
  stepTimings: Array<{ step: string; ms: number; httpStatus?: number }>;
  recentRuns: FailureRunSummary[];
}

export interface Diagnosis {
  summary: string;
  probableCause: string;
  evidence: string[];
  confidence: DiagnosisConfidence;
  provider: "heuristic" | "anthropic";
  model?: string;
}

export interface Diagnoser {
  diagnose(context: FailureContext): Promise<Diagnosis>;
}
