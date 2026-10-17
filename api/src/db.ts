import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/client.js";
import { resolveDatabaseUrl } from "./database-url.js";

export function createDb(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaLibSql({ url }) });
}

export const db = createDb(resolveDatabaseUrl());
