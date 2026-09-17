import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../database/client.js";
import { balanceChanges } from "../database/schema.js";
import { FakeGateway } from "../test-support/fake-gateway.js";
import { WalletService } from "../wallets/wallet-service.js";
import { BalanceTracker } from "./balance-tracker.js";

const mnemonic = "test test test test test test test test test test test junk";

describe("BalanceTracker", () => {
  it("uses one pinned block for every wallet and records aggregate inflows", async () => {
    const database = createDatabase(":memory:");
    const wallets = new WalletService(database.db, mnemonic, 2);
    wallets.initialize();
    const gateway = new FakeGateway();
    const logger = Fastify({ logger: false }).log;
    const tracker = new BalanceTracker(
      database.db,
      wallets,
      gateway,
      60_000,
      logger,
    );

    await tracker.sync();
    gateway.block = { number: 10_001, hash: `0x${"cd".repeat(32)}` };
    gateway.balances.set(
      wallets.derivedWallets[0]!.address.toLowerCase(),
      75_000_000_000_000_000n,
    );
    await tracker.sync();

    expect(
      gateway.balanceReads.every(
        (read) => read.blockNumber === 10_000 || read.blockNumber === 10_001,
      ),
    ).toBe(true);
    const wallet = wallets.getWalletRow(0)!;
    const events = database.db
      .select()
      .from(balanceChanges)
      .where(eq(balanceChanges.walletId, wallet.id))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "INFLOW",
      deltaWei: "75000000000000000",
      blockNumber: 10_001,
    });
    expect(tracker.getHealth().status).toBe("ok");
    database.close();
  });
});
