import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { ChainGateway } from "../blockchain/gateway.js";
import type { AppDatabase } from "../database/client.js";
import {
  balanceChanges,
  syncRuns,
  walletBalances,
  wallets,
  withdrawals
} from "../database/schema.js";
import type { WalletService } from "../wallets/wallet-service.js";

export const TEN_MINUTES_MS = 10 * 60 * 1_000;

export class BalanceTracker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly walletService: WalletService,
    private readonly gateway: ChainGateway,
    private readonly intervalMs: number,
    private readonly logger: FastifyBaseLogger
  ) {}

  async validateNetwork(): Promise<void> {
    const chainId = await this.gateway.getChainId();
    if (chainId !== 84_532n) {
      throw new Error(`RPC chain mismatch: expected Base Sepolia 84532, received ${chainId}`);
    }
  }

  async start(): Promise<void> {
    await this.trySync("startup");
    this.timer = setInterval(() => void this.trySync("interval"), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async trySync(reason: "startup" | "interval" | "manual"): Promise<boolean> {
    if (this.running) {
      this.logger.warn({ reason }, "Skipping overlapping balance sync");
      return false;
    }

    try {
      await this.sync();
      return true;
    } catch (error) {
      this.logger.error({ err: error, reason }, "Balance sync failed");
      return false;
    }
  }

  async sync(): Promise<void> {
    this.running = true;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    this.db.insert(syncRuns).values({ id: runId, status: "RUNNING", startedAt }).run();

    try {
      await this.validateNetwork();
      await this.recoverBroadcasts();
      await this.refreshReceipts();

      const block = await this.gateway.getLatestBlock();
      const managedWallets = this.walletService.listWallets();
      const observedBalances = await Promise.all(
        managedWallets.map((wallet) => this.gateway.getBalance(wallet.address, block.number))
      );
      const observedAt = new Date().toISOString();

      this.db.transaction((tx) => {
        managedWallets.forEach((wallet, position) => {
          const balance = observedBalances[position]!;
          const existing = tx
            .select()
            .from(walletBalances)
            .where(eq(walletBalances.walletId, wallet.id))
            .get();

          if (!existing) {
            tx.insert(walletBalances)
              .values({
                walletId: wallet.id,
                balanceWei: balance.toString(),
                blockNumber: block.number,
                blockHash: block.hash,
                observedAt
              })
              .run();
            if (balance > 0n) {
              tx.insert(balanceChanges)
                .values({
                  id: randomUUID(),
                  walletId: wallet.id,
                  kind: "INITIAL_BALANCE",
                  deltaWei: balance.toString(),
                  newBalanceWei: balance.toString(),
                  blockNumber: block.number,
                  detectedAt: observedAt
                })
                .run();
            }
            return;
          }

          const previous = BigInt(existing.balanceWei);
          if (previous !== balance) {
            const delta = balance - previous;
            tx.insert(balanceChanges)
              .values({
                id: randomUUID(),
                walletId: wallet.id,
                kind: delta > 0n ? "INFLOW" : "UNCLASSIFIED_DECREASE",
                deltaWei: delta.toString(),
                previousBalanceWei: previous.toString(),
                newBalanceWei: balance.toString(),
                blockNumber: block.number,
                detectedAt: observedAt
              })
              .run();
          }

          tx.update(walletBalances)
            .set({
              balanceWei: balance.toString(),
              blockNumber: block.number,
              blockHash: block.hash,
              observedAt
            })
            .where(eq(walletBalances.walletId, wallet.id))
            .run();
        });

        tx.update(syncRuns)
          .set({ status: "SUCCEEDED", blockNumber: block.number, completedAt: observedAt })
          .where(eq(syncRuns.id, runId))
          .run();
      });
    } catch (error) {
      this.db
        .update(syncRuns)
        .set({
          status: "FAILED",
          completedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : "Unknown sync failure"
        })
        .where(eq(syncRuns.id, runId))
        .run();
      throw error;
    } finally {
      this.running = false;
    }
  }

  getHealth() {
    const latest = this.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "SUCCEEDED"))
      .orderBy(desc(syncRuns.completedAt))
      .limit(1)
      .get();
    const lastSuccessAt = latest?.completedAt ?? null;
    const stale = !lastSuccessAt || Date.now() - new Date(lastSuccessAt).getTime() > TEN_MINUTES_MS;
    return {
      status: stale ? "degraded" : "ok",
      stale,
      lastSuccessAt,
      lastObservedBlock: latest?.blockNumber ?? null,
      pollingIntervalSeconds: this.intervalMs / 1_000,
      syncInProgress: this.running
    } as const;
  }

  private async recoverBroadcasts(): Promise<void> {
    const candidates = this.db
      .select()
      .from(withdrawals)
      .where(inArray(withdrawals.state, ["BUILT", "FAILED"]))
      .all();

    for (const candidate of candidates) {
      if (await this.gateway.transactionExists(candidate.txHash)) {
        this.markBroadcast(candidate.id, candidate.walletId, candidate.amountWei, candidate.txHash);
      }
    }
  }

  private async refreshReceipts(): Promise<void> {
    const pending = this.db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.state, "BROADCAST"))
      .all();

    for (const withdrawal of pending) {
      const receipt = await this.gateway.getReceipt(withdrawal.txHash);
      if (!receipt) continue;
      const now = new Date().toISOString();
      this.db
        .update(withdrawals)
        .set({
          state: receipt.status === 1 ? "CONFIRMED" : "REVERTED",
          confirmedAt: now,
          actualFeeWei: (receipt.gasUsed * receipt.gasPrice).toString(),
          updatedAt: now
        })
        .where(eq(withdrawals.id, withdrawal.id))
        .run();
    }
  }

  private markBroadcast(id: string, walletId: number, amountWei: string, txHash: string): void {
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.update(withdrawals)
        .set({ state: "BROADCAST", broadcastAt: now, errorMessage: null, updatedAt: now })
        .where(eq(withdrawals.id, id))
        .run();
      tx.insert(balanceChanges)
        .values({
          id: randomUUID(),
          walletId,
          kind: "WITHDRAWAL_BROADCAST",
          deltaWei: (-BigInt(amountWei)).toString(),
          txHash,
          withdrawalId: id,
          detectedAt: now
        })
        .onConflictDoNothing({ target: balanceChanges.withdrawalId })
        .run();
    });
  }
}
