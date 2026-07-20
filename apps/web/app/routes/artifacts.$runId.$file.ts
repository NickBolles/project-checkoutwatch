import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { requestContext } from "../services/request.server.js";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { runId?: string; file?: string };
}) {
  if (!params.runId || !params.file) throw new Response("Artifact not found", { status: 404 });
  const { shop, runtime } = await requestContext(request);
  const run = await runtime.client.checkRun.findFirst({
    where: { id: params.runId, monitor: { shopId: shop.id } },
    select: { screenshotPath: true },
  });
  if (!run?.screenshotPath || basename(run.screenshotPath) !== basename(params.file))
    throw new Response("Artifact not found", { status: 404 });
  const artifactRoot = resolve(runtime.config.artifactDir);
  const artifactPath = resolve(run.screenshotPath);
  if (
    artifactPath !== artifactRoot &&
    !artifactPath.startsWith(`${artifactRoot}\\`) &&
    !artifactPath.startsWith(`${artifactRoot}/`)
  )
    throw new Response("Artifact path rejected", { status: 403 });
  const body = await readFile(artifactPath);
  return new Response(body, {
    headers: {
      "content-type": params.file.endsWith(".png") ? "image/png" : "application/octet-stream",
      "cache-control": "private, max-age=60",
    },
  });
}
