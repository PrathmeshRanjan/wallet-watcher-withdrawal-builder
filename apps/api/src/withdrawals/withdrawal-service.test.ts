import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../database/client.js";
import { balanceChanges } from "../database/schema.js";
import { InsufficientFundsError } from "../errors.js";
import { FakeGateway } from "../test-support/fake-gateway.js";
import { WalletService } from "../wallets/wallet-service.js";
import { WithdrawalService } from "./withdrawal-service.js";

const mnemonic = "test test test test test test test test test test test junk";
const destination = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function setup() {
  const database = createDatabase(":memory:");
  const wallets = new WalletService(database.db, mnemonic, 2);
  wallets.initialize();
  const gateway = new FakeGateway();
  gateway.balances.set(
    wallets.derivedWallets[0]!.address.toLowerCase(),
    2_000_000_000_000_000_000n,
  );
  const service = new WithdrawalService(database.db, wallets, gateway);
  return { database, wallets, gateway, service };
}

describe("WithdrawalService", () => {
  it("persists a signed build without creating an outflow", async () => {
    const { database, service } = setup();
    const result = await service.create({
      walletIndex: 0,
      to: destination,
      amountEth: "0.123456789012345678",
      broadcast: false,
    });
    expect(result.state).toBe("BUILT");
    expect(result.amountWei).toBe("123456789012345678");
    expect(database.db.select().from(balanceChanges).all()).toHaveLength(0);
    database.close();
  });

  it("records one outflow after broadcast and remains idempotent", async () => {
    const { database, gateway, service } = setup();
    const first = await service.create({
      walletIndex: 0,
      to: destination,
      amountEth: "0.1",
      broadcast: true,
      idempotencyKey: "same-request",
    });
    const replay = await service.create({
      walletIndex: 0,
      to: destination,
      amountEth: "0.1",
      broadcast: true,
      idempotencyKey: "same-request",
    });
    const events = database.db
      .select()
      .from(balanceChanges)
      .where(eq(balanceChanges.withdrawalId, first.id))
      .all();
    expect(first.state).toBe("BROADCAST");
    expect(replay.id).toBe(first.id);
    expect(gateway.broadcasted).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.deltaWei).toBe("-100000000000000000");
    database.close();
  });

  it("reserves the maximum fee when checking available funds", async () => {
    const { database, wallets, gateway, service } = setup();
    gateway.balances.set(
      wallets.derivedWallets[0]!.address.toLowerCase(),
      100_000_000_000_000_000n,
    );
    await expect(
      service.create({
        walletIndex: 0,
        to: destination,
        amountEth: "0.1",
        broadcast: false,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    database.close();
  });
});
