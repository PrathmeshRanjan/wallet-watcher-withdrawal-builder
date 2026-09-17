import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { asc, desc, eq } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { formatEther } from "ethers";
import { z } from "zod";
import { BalanceTracker } from "./balances/balance-tracker.js";
import type { ChainGateway } from "./blockchain/gateway.js";
import type { AppConfig } from "./config.js";
import type { DatabaseHandle } from "./database/client.js";
import { balanceChanges, wallets } from "./database/schema.js";
import { AppError } from "./errors.js";
import { WalletService } from "./wallets/wallet-service.js";
import { serializeWithdrawal, WithdrawalService } from "./withdrawals/withdrawal-service.js";

const createWithdrawalSchema = z.object({
  walletIndex: z.number().int().min(0).max(19),
  to: z.string().trim().min(1),
  amountEth: z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/, "Amount must be a positive ETH decimal string with at most 18 decimals"),
  broadcast: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(1).max(128).optional()
});

const idParamsSchema = z.object({ id: z.uuid() });
const walletParamsSchema = z.object({ index: z.coerce.number().int().min(0).max(19) });

export type AppContext = {
  app: FastifyInstance;
  walletService: WalletService;
  withdrawalService: WithdrawalService;
  balanceTracker: BalanceTracker;
};

export async function createApp(
  config: AppConfig,
  database: DatabaseHandle,
  gateway: ChainGateway
): Promise<AppContext> {
  const app = Fastify({
    logger: config.nodeEnv === "test" ? false : { level: config.logLevel },
    genReqId: () => randomUUID(),
    disableRequestLogging: config.nodeEnv === "test"
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"]
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Vaultline Wallet Operations API",
        description: "Deterministic Base Sepolia wallet tracking and signed native ETH withdrawals.",
        version: "1.0.0"
      },
      servers: [{ url: `http://${config.host}:${config.port}` }],
      tags: [
        { name: "system", description: "Health and synchronization" },
        { name: "wallets", description: "Managed wallets and balance activity" },
        { name: "withdrawals", description: "Build and optionally broadcast signed withdrawals" }
      ]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  const walletService = new WalletService(database.db, config.mnemonic, config.walletCount);
  walletService.initialize();
  const withdrawalService = new WithdrawalService(database.db, walletService, gateway);
  const balanceTracker = new BalanceTracker(
    database.db,
    walletService,
    gateway,
    config.pollIntervalMs,
    app.log
  );

  const requireAdmin = async (request: FastifyRequest): Promise<void> => {
    if (!config.adminApiKey) return;
    if (request.headers.authorization !== `Bearer ${config.adminApiKey}`) {
      throw new AppError("A valid bearer token is required", 401, "UNAUTHORIZED");
    }
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues },
        requestId: request.id
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      requestId: request.id
    });
  });

  app.get(
    "/api/v1/health",
    {
      schema: {
        tags: ["system"],
        summary: "Read service and tracking health"
      }
    },
    async (_request, reply) => {
      const health = balanceTracker.getHealth();
      return reply.status(health.stale ? 503 : 200).send({
        service: "wallet-watcher-withdrawal-builder",
        network: "base-sepolia",
        chainId: 84532,
        ...health
      });
    }
  );

  app.post(
    "/api/v1/tracking/sync",
    {
      preHandler: requireAdmin,
      schema: { tags: ["system"], summary: "Trigger an immediate balance reconciliation" }
    },
    async (_request, reply) => {
      const completed = await balanceTracker.trySync("manual");
      return reply.status(completed ? 200 : 409).send({ completed, health: balanceTracker.getHealth() });
    }
  );

  app.get(
    "/api/v1/wallets",
    {
      schema: { tags: ["wallets"], summary: "List deterministic wallets and current balances" }
    },
    async () => {
      const health = balanceTracker.getHealth();
      return {
        network: "base-sepolia",
        chainId: 84532,
        asset: { symbol: "ETH", decimals: 18 },
        stale: health.stale,
        lastSuccessAt: health.lastSuccessAt,
        wallets: walletService.listWallets().map((wallet) => ({
          index: wallet.index,
          address: wallet.address,
          derivationPath: wallet.derivationPath,
          balance: {
            wei: wallet.balanceWei ?? "0",
            eth: formatEther(wallet.balanceWei ?? "0")
          },
          observedAt: wallet.observedAt,
          blockNumber: wallet.blockNumber,
          blockHash: wallet.blockHash,
          explorerUrl: `https://sepolia.basescan.org/address/${wallet.address}`
        }))
      };
    }
  );

  app.get(
    "/api/v1/wallets/:index/changes",
    {
      schema: { tags: ["wallets"], summary: "List balance changes for one wallet" }
    },
    async (request) => {
      const { index } = walletParamsSchema.parse(request.params);
      const wallet = database.db.select().from(wallets).where(eq(wallets.walletIndex, index)).get();
      if (!wallet) throw new AppError("Wallet was not found", 404, "NOT_FOUND");
      const changes = database.db
        .select()
        .from(balanceChanges)
        .where(eq(balanceChanges.walletId, wallet.id))
        .orderBy(desc(balanceChanges.detectedAt))
        .limit(100)
        .all();
      return {
        wallet: { index: wallet.walletIndex, address: wallet.address },
        changes: changes.map((change) => ({
          id: change.id,
          kind: change.kind,
          delta: { wei: change.deltaWei, eth: formatEther(change.deltaWei) },
          previousBalanceWei: change.previousBalanceWei,
          newBalanceWei: change.newBalanceWei,
          blockNumber: change.blockNumber,
          txHash: change.txHash,
          detectedAt: change.detectedAt
        }))
      };
    }
  );

  app.get(
    "/api/v1/withdrawals",
    {
      schema: { tags: ["withdrawals"], summary: "List recent withdrawal attempts" }
    },
    async () => ({ withdrawals: withdrawalService.list().map((row) => serializeWithdrawal(row, false)) })
  );

  app.get(
    "/api/v1/withdrawals/:id",
    {
      schema: { tags: ["withdrawals"], summary: "Read a withdrawal and its signed payload" }
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      return serializeWithdrawal(withdrawalService.getById(id));
    }
  );

  app.post(
    "/api/v1/withdrawals",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["withdrawals"],
        summary: "Build and optionally broadcast a signed native ETH withdrawal"
      }
    },
    async (request, reply) => {
      const body = createWithdrawalSchema.parse(request.body);
      const headerKey = request.headers["idempotency-key"];
      const { idempotencyKey: bodyKey, ...withdrawalInput } = body;
      const idempotencyKey = typeof headerKey === "string" ? headerKey : bodyKey;
      const row = await withdrawalService.create({
        ...withdrawalInput,
        ...(idempotencyKey ? { idempotencyKey } : {})
      });
      return reply.status(201).send(serializeWithdrawal(row));
    }
  );

  app.post(
    "/api/v1/withdrawals/:id/broadcast",
    {
      preHandler: requireAdmin,
      schema: { tags: ["withdrawals"], summary: "Broadcast a previously built withdrawal" }
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      return serializeWithdrawal(await withdrawalService.broadcast(id));
    }
  );

  app.get("/api/v1", async () => ({
    name: "Vaultline Wallet Operations API",
    version: "1.0.0",
    docs: "/docs",
    network: "base-sepolia"
  }));

  return { app, walletService, withdrawalService, balanceTracker };
}
