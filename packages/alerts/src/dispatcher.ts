import { MockAdapter } from "./adapters/mock.js";
import type {
  AlertChannelAdapter,
  AlertMessage,
  AlertRoute,
  ChannelType,
  DeliveryLogStore,
  DeliveryResult,
} from "./types.js";

export interface DispatcherOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  mockOutboxDir?: string;
}

export class AlertDispatcher {
  private readonly adapters: Map<ChannelType, AlertChannelAdapter>;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly mockAdapters = new Map<ChannelType, MockAdapter>();

  constructor(
    private readonly store: DeliveryLogStore,
    adapters: readonly AlertChannelAdapter[],
    private readonly options: DispatcherOptions = {},
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.type, adapter]));
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 100;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async dispatch(message: AlertMessage, routes: readonly AlertRoute[]): Promise<string[]> {
    const ids = await Promise.all(
      routes.map((route) =>
        this.store.record({
          messageKey: message.key,
          event: message.event,
          channelType: route.channel,
          destination: route.destination,
          status: route.enabled === false ? "skipped" : "queued",
          attempts: 0,
          ...(message.meta ? { meta: message.meta } : {}),
          ...(route.enabled === false
            ? { detail: route.skipReason ?? "route is not entitled or disabled" }
            : {}),
        }),
      ),
    );

    await Promise.all(
      routes.map(async (route, index) => {
        const id = ids[index];
        if (!id || route.enabled === false) return;
        const claimed = await this.store.transition(id, "queued", "sending");
        if (!claimed) return;
        const adapter = this.adapterFor(route);
        if (!adapter) {
          await this.store.transition(id, "sending", "failed", `No adapter for ${route.channel}`);
          return;
        }
        await this.sendWithRetry(id, adapter, route.destination, message);
      }),
    );
    return ids;
  }

  private adapterFor(route: AlertRoute): AlertChannelAdapter | undefined {
    if (!route.destination.startsWith("mock://")) return this.adapters.get(route.channel);
    let adapter = this.mockAdapters.get(route.channel);
    if (!adapter) {
      adapter = new MockAdapter(route.channel, this.options.mockOutboxDir);
      this.mockAdapters.set(route.channel, adapter);
    }
    return adapter;
  }

  private async sendWithRetry(
    id: string,
    adapter: AlertChannelAdapter,
    destination: string,
    message: AlertMessage,
  ): Promise<void> {
    let result: DeliveryResult = { status: "failed", error: "send was not attempted" };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        result = await adapter.send(destination, message);
      } catch (error) {
        result = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (result.status !== "failed") {
        await this.store.transition(id, "sending", result.status, encodeDetail(result));
        return;
      }
      if (attempt < this.maxAttempts) {
        await this.sleep(this.baseBackoffMs * 2 ** (attempt - 1));
      }
    }
    await this.store.transition(id, "sending", "failed", encodeDetail(result));
  }
}

function encodeDetail(result: DeliveryResult): string | undefined {
  if (!result.providerMessageId && !result.error) return undefined;
  return JSON.stringify({
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    ...(result.error ? { error: result.error } : {}),
  });
}
