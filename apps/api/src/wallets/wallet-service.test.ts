import { describe, expect, it } from "vitest";
import { createDatabase } from "../database/client.js";
import { deriveWallets, WalletService } from "./wallet-service.js";

const mnemonic = "test test test test test test test test test test test junk";

describe("deriveWallets", () => {
  it("derives the expected indexed Ethereum accounts", () => {
    const result = deriveWallets(mnemonic, 2);
    expect(result).toEqual([
      {
        index: 0,
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        derivationPath: "m/44'/60'/0'/0/0",
      },
      {
        index: 1,
        address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        derivationPath: "m/44'/60'/0'/0/1",
      },
    ]);
  });

  it("preserves the prefix when the wallet count grows or shrinks", () => {
    const three = deriveWallets(mnemonic, 3);
    const seven = deriveWallets(mnemonic, 7);
    expect(seven.slice(0, three.length)).toEqual(three);
    expect(deriveWallets(mnemonic, 3)).toEqual(three);
  });

  it.each([0, 21, 1.5])("rejects an invalid wallet count: %s", (count) => {
    expect(() => deriveWallets(mnemonic, count)).toThrow(RangeError);
  });
});

describe("WalletService persistence", () => {
  it("keeps higher indexes as inactive history when the configured count shrinks", () => {
    const database = createDatabase(":memory:");
    new WalletService(database.db, mnemonic, 4).initialize();
    const smaller = new WalletService(database.db, mnemonic, 2);
    smaller.initialize();
    expect(smaller.listWallets()).toHaveLength(2);
    const total = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM wallets")
      .get() as { count: number };
    expect(total.count).toBe(4);
    database.close();
  });

  it("refuses to mix a new mnemonic into an existing wallet database", () => {
    const database = createDatabase(":memory:");
    new WalletService(database.db, mnemonic, 1).initialize();
    expect(() =>
      new WalletService(
        database.db,
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        1,
      ).initialize(),
    ).toThrow(/does not match/);
    database.close();
  });
});
