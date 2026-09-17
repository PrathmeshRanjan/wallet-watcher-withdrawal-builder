import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { runMigrations } from "./migrations.js";
import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseHandle = {
  db: AppDatabase;
  sqlite: BetterSqlite3.Database;
  close: () => void;
};

export function createDatabase(databasePath: string): DatabaseHandle {
  const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(process.cwd(), databasePath);
  if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });

  const sqlite = new BetterSqlite3(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  runMigrations(sqlite);

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    close: () => sqlite.close()
  };
}

