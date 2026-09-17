import { and, asc, eq, lt } from "drizzle-orm";
import { getIndexedAccountPath, HDNodeWallet, Mnemonic } from "ethers";
import type { AppDatabase } from "../database/client.js";
import { walletBalances, wallets, type WalletRow } from "../database/schema.js";

export type DerivedWallet = {
  index: number;
  address: string;
  derivationPath: string;
};

export function deriveWallets(
  mnemonicPhrase: string,
  count: number,
): DerivedWallet[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new RangeError("Wallet count must be an integer between 1 and 20");
  }

  const mnemonic = Mnemonic.fromPhrase(mnemonicPhrase);
  return Array.from({ length: count }, (_, index) => {
    const derivationPath = getIndexedAccountPath(index);
    const wallet = HDNodeWallet.fromMnemonic(mnemonic, derivationPath);
    return { index, address: wallet.address, derivationPath };
  });
}

export class WalletService {
  readonly derivedWallets: DerivedWallet[];

  constructor(
    private readonly db: AppDatabase,
    private readonly mnemonicPhrase: string,
    readonly walletCount: number,
  ) {
    this.derivedWallets = deriveWallets(mnemonicPhrase, walletCount);
  }

  initialize(): void {
    const now = new Date().toISOString();
    for (const wallet of this.derivedWallets) {
      const existing = this.db
        .select()
        .from(wallets)
        .where(eq(wallets.walletIndex, wallet.index))
        .get();
      if (
        existing &&
        existing.address.toLowerCase() !== wallet.address.toLowerCase()
      ) {
        throw new Error(
          `HD_MNEMONIC does not match the existing database at wallet index ${wallet.index}; use the original mnemonic or a fresh database`,
        );
      }
    }
    this.db.transaction((tx) => {
      tx.update(wallets).set({ active: false, updatedAt: now }).run();
      for (const wallet of this.derivedWallets) {
        tx.insert(wallets)
          .values({
            walletIndex: wallet.index,
            address: wallet.address,
            derivationPath: wallet.derivationPath,
            active: true,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: wallets.walletIndex,
            set: {
              address: wallet.address,
              derivationPath: wallet.derivationPath,
              active: true,
              updatedAt: now,
            },
          })
          .run();
      }
    });
  }

  getSigner(walletIndex: number): HDNodeWallet {
    if (
      !Number.isInteger(walletIndex) ||
      walletIndex < 0 ||
      walletIndex >= this.walletCount
    ) {
      throw new RangeError(
        `Wallet index must be between 0 and ${this.walletCount - 1}`,
      );
    }
    return HDNodeWallet.fromPhrase(
      this.mnemonicPhrase,
      undefined,
      this.derivedWallets[walletIndex]!.derivationPath,
    );
  }

  getWalletRow(walletIndex: number): WalletRow | undefined {
    return this.db
      .select()
      .from(wallets)
      .where(
        and(eq(wallets.walletIndex, walletIndex), eq(wallets.active, true)),
      )
      .get();
  }

  listWallets() {
    return this.db
      .select({
        id: wallets.id,
        index: wallets.walletIndex,
        address: wallets.address,
        derivationPath: wallets.derivationPath,
        balanceWei: walletBalances.balanceWei,
        blockNumber: walletBalances.blockNumber,
        blockHash: walletBalances.blockHash,
        observedAt: walletBalances.observedAt,
      })
      .from(wallets)
      .leftJoin(walletBalances, eq(wallets.id, walletBalances.walletId))
      .where(
        and(
          eq(wallets.active, true),
          lt(wallets.walletIndex, this.walletCount),
        ),
      )
      .orderBy(asc(wallets.walletIndex))
      .all();
  }
}
