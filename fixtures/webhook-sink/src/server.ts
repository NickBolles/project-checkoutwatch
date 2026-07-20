import express from "express";
import type { Server } from "node:http";

export interface RecordedWebhook {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export async function startWebhookSink(port = 0): Promise<{ url: string; requests: RecordedWebhook[]; close(): Promise<void> }> {
  const app = express();
  const requests: RecordedWebhook[] = [];
  app.use(express.json());
  app.get("/__requests", (_request, response) => response.json(requests));
  app.delete("/__requests", (_request, response) => {
    requests.length = 0;
    response.status(204).end();
  });
  app.post("/{*path}", (request, response) => {
    requests.push({ method: request.method, path: request.path, headers: request.headers, body: request.body });
    response.status(204).end();
  });
  const server = await listen(app, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("webhook sink did not bind TCP");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function listen(app: ReturnType<typeof express>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}
