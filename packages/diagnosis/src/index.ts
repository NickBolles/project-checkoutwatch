import {
  AnthropicDiagnoser,
  createAnthropicClient,
  DEFAULT_LLM_MODEL,
  type AnthropicMessagesClient,
} from "./anthropic.js";
import { HeuristicDiagnoser } from "./heuristic.js";
import type { Diagnoser } from "./types.js";

export * from "./types.js";
export * from "./heuristic.js";
export * from "./anthropic.js";

export interface DiagnoserFactoryOptions {
  allowLlm: boolean;
  apiKey?: string;
  provider?: "heuristic" | "anthropic";
  model?: string;
  client?: AnthropicMessagesClient;
  onFallback?: (error: unknown) => void;
}

export function createDiagnoser(options: DiagnoserFactoryOptions): Diagnoser {
  const fallback = new HeuristicDiagnoser();
  if (!options.allowLlm || options.provider === "heuristic" || (!options.apiKey && !options.client))
    return fallback;
  const client = options.client ?? createAnthropicClient(options.apiKey!);
  return new AnthropicDiagnoser(client, {
    model: options.model ?? DEFAULT_LLM_MODEL,
    fallback,
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
  });
}
