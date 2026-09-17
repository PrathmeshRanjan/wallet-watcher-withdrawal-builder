import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { FakeGateway } from "./test-support/fake-gateway.js";

const mnemonic = "test test test test test test test test test test test junk";

function config(adminApiKey?: string): AppConfig {
  return {
    nodeEnv: "test",
    mnemonic,
    rpcUrl: "https://example.invalid",
    walletCount: 2,
    pollIntervalMs: 60_000,
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 3000,
    logLevel: "silent",
    ...(adminApiKey ? { adminApiKey } : {}),
    corsOrigins: ["http://localhost:5173"],
  };
}

describe("HTTP API", () => {
  it("exposes health, pinned balances, activity, withdrawals and documentation", async () => {
    const database = createDatabase(":memory:");
    const gateway = new FakeGateway();
    const context = await createApp(config(), database, gateway);
    const firstWallet = context.walletService.derivedWallets[0]!;
    gateway.balances.set(
      firstWallet.address.toLowerCase(),
      1_000_000_000_000_000_000n,
    );
    await context.balanceTracker.sync();

    const health = await context.app.inject({
      method: "GET",
      url: "/api/v1/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", chainId: 84532 });

    const wallets = await context.app.inject({
      method: "GET",
      url: "/api/v1/wallets",
    });
    expect(wallets.statusCode).toBe(200);
    expect(wallets.json().wallets[0]).toMatchObject({
      index: 0,
      address: firstWallet.address,
      balance: { wei: "1000000000000000000", eth: "1.0" },
    });

    const changes = await context.app.inject({
      method: "GET",
      url: "/api/v1/wallets/0/changes",
    });
    expect(changes.statusCode).toBe(200);
    expect(changes.json().changes[0].kind).toBe("INITIAL_BALANCE");

    const list = await context.app.inject({
      method: "GET",
      url: "/api/v1/withdrawals",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().withdrawals).toEqual([]);

    const docs = await context.app.inject({ method: "GET", url: "/docs/json" });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().info.title).toContain("Vaultline");

    await context.app.close();
    database.close();
  });

  it("validates requests and protects mutation routes when an API key is configured", async () => {
    const database = createDatabase(":memory:");
    const gateway = new FakeGateway();
    const context = await createApp(
      config("a-secure-test-key"),
      database,
      gateway,
    );
    const wallet = context.walletService.derivedWallets[0]!;
    gateway.balances.set(
      wallet.address.toLowerCase(),
      2_000_000_000_000_000_000n,
    );

    const unauthorized = await context.app.inject({
      method: "POST",
      url: "/api/v1/withdrawals",
      payload: {
        walletIndex: 0,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        amountEth: "0.1",
        broadcast: false,
      },
    });
    expect(unauthorized.statusCode).toBe(401);

    const invalid = await context.app.inject({
      method: "POST",
      url: "/api/v1/withdrawals",
      headers: { authorization: "Bearer a-secure-test-key" },
      payload: { walletIndex: 0, to: "bad", amountEth: 0.1, broadcast: false },
    });
    expect(invalid.statusCode).toBe(400);

    const built = await context.app.inject({
      method: "POST",
      url: "/api/v1/withdrawals",
      headers: {
        authorization: "Bearer a-secure-test-key",
        "idempotency-key": "api-test-build",
      },
      payload: {
        walletIndex: 0,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        amountEth: "0.1",
        broadcast: false,
      },
    });
    expect(built.statusCode).toBe(201);
    expect(built.json()).toMatchObject({
      state: "BUILT",
      amount: { eth: "0.1" },
    });
    expect(built.json().signedTransaction).toMatch(/^0x/);

    const detail = await context.app.inject({
      method: "GET",
      url: `/api/v1/withdrawals/${built.json().id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().txHash).toBe(built.json().txHash);

    await context.app.close();
    database.close();
  });
});
