import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prismaExecutable = process.platform === "win32" ? "prisma.CMD" : "prisma";

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "file:../../../var/dev.db",
};

const result = spawnSync(
  prismaExecutable,
  [...process.argv.slice(2), "--schema", "prisma/schema.prisma"],
  {
    cwd: packageRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
