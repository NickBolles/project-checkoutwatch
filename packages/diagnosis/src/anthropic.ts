import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HeuristicDiagnoser } from "./heuristic.js";
import type { Diagnosis, Diagnoser, FailureContext } from "./types.js";

export const DEFAULT_LLM_MODEL = "claude-opus-4-8";

const diagnosisSchema = z.object({
  summary: z.string().min(1),
  probableCause: z.string().min(1),
  evidence: z.array(z.string().min(1)),
  confidence: z.enum(["low", "medium", "high"]),
});

export interface AnthropicMessagesClient {
  messages: {
    create(request: Record<string, unknown>, options?: { timeout?: number }): Promise<unknown>;
  };
}

export interface AnthropicDiagnoserOptions {
  model?: string;
  timeoutMs?: number;
  fallback?: Diagnoser;
  onFallback?: (error: unknown) => void;
}

export class AnthropicDiagnoser implements Diagnoser {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fallback: Diagnoser;

  constructor(
    private readonly client: AnthropicMessagesClient,
    private readonly options: AnthropicDiagnoserOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_LLM_MODEL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fallback = options.fallback ?? new HeuristicDiagnoser();
  }

  async diagnose(context: FailureContext): Promise<Diagnosis> {
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 900,
          system:
            "You diagnose synthetic Shopify checkout failures. Be concise, evidence-based, and never invent evidence.",
          messages: [{ role: "user", content: JSON.stringify(context) }],
          output_config: {
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["summary", "probableCause", "evidence", "confidence"],
                properties: {
                  summary: { type: "string" },
                  probableCause: { type: "string" },
                  evidence: { type: "array", items: { type: "string" } },
                  confidence: { type: "string", enum: ["low", "medium", "high"] },
                },
              },
            },
          },
        },
        { timeout: this.timeoutMs },
      );
      const parsed = diagnosisSchema.parse(JSON.parse(extractText(response)) as unknown);
      return { ...parsed, provider: "anthropic", model: this.model };
    } catch (error) {
      this.options.onFallback?.(error);
      return this.fallback.diagnose(context);
    }
  }
}

export function createAnthropicClient(apiKey: string): AnthropicMessagesClient {
  return new Anthropic({ apiKey }) as unknown as AnthropicMessagesClient;
}

function extractText(response: unknown): string {
  if (typeof response !== "object" || response === null || !("content" in response))
    throw new Error("Anthropic response has no content");
  const content: unknown = response.content;
  if (!Array.isArray(content)) throw new Error("Anthropic response has no content");
  const block = content.find(
    (candidate: unknown): candidate is { type: "text"; text: string } =>
      typeof candidate === "object" &&
      candidate !== null &&
      "type" in candidate &&
      candidate.type === "text" &&
      "text" in candidate &&
      typeof candidate.text === "string",
  );
  if (!block) throw new Error("Anthropic response has no text block");
  return block.text;
}
