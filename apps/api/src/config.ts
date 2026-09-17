import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

function loadEnvironmentFile(): void {
  if (process.env.NODE_ENV === "test") return;

  const candidates = [
    process.env.ENV_FILE,
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env")
  ].filter((candidate): candidate is string => Boolean(candidate));

  const envFile = candidates.find(existsSync);
  if (envFile) loadDotEnv({ path: envFile });
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HD_MNEMONIC: z.string().trim().min(1, "HD_MNEMONIC is required"),
  BASE_SEPOLIA_RPC_URL: z.url().default("https://sepolia.base.org"),
  WALLET_COUNT: z.coerce.number().int().min(1).max(20).default(3),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  DATABASE_PATH: z.string().min(1).default("./data/wallet-watcher.db"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ADMIN_API_KEY: z.string().min(12).optional().or(z.literal("")),
  CORS_ORIGINS: z.string().default("http://localhost:5173")
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  mnemonic: string;
  rpcUrl: string;
  walletCount: number;
  pollIntervalMs: number;
  databasePath: string;
  host: string;
  port: number;
  logLevel: string;
  adminApiKey?: string;
  corsOrigins: string[];
};

export function getConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  loadEnvironmentFile();
  const parsed = environmentSchema.parse({ ...process.env, ...overrides });

  return {
    nodeEnv: parsed.NODE_ENV,
    mnemonic: parsed.HD_MNEMONIC,
    rpcUrl: parsed.BASE_SEPOLIA_RPC_URL,
    walletCount: parsed.WALLET_COUNT,
    pollIntervalMs: parsed.POLL_INTERVAL_SECONDS * 1_000,
    databasePath: parsed.DATABASE_PATH,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.ADMIN_API_KEY ? { adminApiKey: parsed.ADMIN_API_KEY } : {}),
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  };
}

