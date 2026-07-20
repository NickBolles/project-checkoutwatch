import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPrismaClient } from "@checkoutwatch/db";

export async function isolatedClient(prefix = "checkoutwatch-web-") {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const databasePath = join(directory, "test.db");
  await copyFile(resolve(import.meta.dirname, "../../../var/dev.db"), databasePath);
  return { directory, client: createPrismaClient(`file:${databasePath.replaceAll("\\", "/")}`) };
}
