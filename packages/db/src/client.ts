import { PrismaClient } from "@prisma/client";
import { isAbsolute, resolve } from "node:path";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function normalizeDatabaseUrl(databaseUrl: string, cwd = process.cwd()): string {
  if (!databaseUrl.startsWith("file:")) return databaseUrl;

  const filePath = databaseUrl.slice("file:".length);
  if (isAbsolute(filePath)) return databaseUrl.replaceAll("\\", "/");

  return `file:${resolve(cwd, filePath).replaceAll("\\", "/")}`;
}

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(
    databaseUrl ? { datasourceUrl: normalizeDatabaseUrl(databaseUrl) } : undefined,
  );
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
