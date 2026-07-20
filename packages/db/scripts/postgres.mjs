import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceSchema = resolve(packageRoot, "prisma/schema.prisma");
const generatedSchema = resolve(packageRoot, "prisma/generated/schema.postgresql.prisma");
const source = readFileSync(sourceSchema, "utf8");
const providerDeclaration = 'provider = "sqlite"';
if (!source.includes(providerDeclaration)) {
  throw new Error("Expected the portable Prisma schema to use the SQLite development provider");
}

mkdirSync(dirname(generatedSchema), { recursive: true });
writeFileSync(
  generatedSchema,
  source.replace(providerDeclaration, 'provider = "postgresql"'),
  "utf8",
);

const prismaExecutable = process.platform === "win32" ? "prisma.CMD" : "prisma";
const result = spawnSync(
  prismaExecutable,
  [...process.argv.slice(2), "--schema", generatedSchema],
  {
    cwd: packageRoot,
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://checkoutwatch:checkoutwatch@localhost/checkoutwatch",
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
