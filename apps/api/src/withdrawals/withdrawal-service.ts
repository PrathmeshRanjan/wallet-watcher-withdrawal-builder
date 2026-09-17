import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { formatEther, getAddress, parseEther } from "ethers";
import type { ChainGateway } from "../blockchain/gateway.js";
import type { AppDatabase } from "../database/client.js";
import { balanceChanges, withdrawals, type WithdrawalRow } from "../database/schema.js";
import {
  ConflictError,
  InsufficientFundsError,
  NotFoundError,
  UpstreamError,
  ValidationError
} from "../errors.js";
import type { WalletService } from "../wallets/wallet-service.js";
import { BASE_SEPOLIA_CHAIN_ID, buildSignedNativeTransfer } from "./transaction-builder.js";

export type CreateWithdrawalInput = {
  walletIndex: number;
  to: string;
  amountEth: string;
  broadcast: boolean;
  idempotencyKey?: string;
};

class KeyedMutex {
  private tails = new Map<number, Promise<void>>();

  async run<T>(key: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, previous.then(() => current));
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}

export class WithdrawalService {
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly db: AppDatabase,
    private readonly walletService: WalletService,
    private readonly gateway: ChainGateway
  ) {}

  create(input: CreateWithdrawalInput): Promise<WithdrawalRow> {
    return this.mutex.run(input.walletIndex, async () => {
      if (input.idempotencyKey) {
        const existing = this.db
          .select()
          .from(withdrawals)
          .where(eq(withdrawals.idempotencyKey, input.idempotencyKey))
          .get();
        if (existing) {
          this.assertIdempotentMatch(existing, input);
          return input.broadcast && existing.state === "BUILT" ? this.broadcast(existing.id) : existing;
        }
      }

      const walletRow = this.walletService.getWalletRow(input.walletIndex);
      if (!walletRow) throw new NotFoundError(`Active wallet ${input.walletIndex} was not found`);

      let to: string;
      let amountWei: bigint;
      try {
        to = getAddress(input.to);
        amountWei = parseEther(input.amountEth);
      } catch {
        throw new ValidationError("Destination or ETH amount is invalid");
      }
      if (amountWei <= 0n) throw new ValidationError("Withdrawal amount must be greater than zero");
      if (to.toLowerCase() === walletRow.address.toLowerCase()) {
        throw new ValidationError("Destination must differ from the source wallet");
      }

      const chainId = await this.gateway.getChainId();
      if (chainId !== BigInt(BASE_SEPOLIA_CHAIN_ID)) {
        throw new UpstreamError(`RPC chain mismatch: expected ${BASE_SEPOLIA_CHAIN_ID}, received ${chainId}`);
      }

      const signer = this.walletService.getSigner(input.walletIndex);
      const [balance, nonce, fees] = await Promise.all([
        this.gateway.getBalance(signer.address),
        this.gateway.getPendingNonce(signer.address),
        this.gateway.getFeeQuote()
      ]);
      const estimatedGas = await this.gateway.estimateNativeTransferGas(signer.address, to, amountWei);
      const gasLimit = (estimatedGas * 120n + 99n) / 100n;
      const maximumFeeWei = gasLimit * fees.maxFeePerGas;
      if (amountWei + maximumFeeWei > balance) {
        throw new InsufficientFundsError("Balance cannot cover the amount plus maximum network fee", {
          balanceWei: balance.toString(),
          amountWei: amountWei.toString(),
          maximumFeeWei: maximumFeeWei.toString()
        });
      }

      const built = await buildSignedNativeTransfer({
        signer,
        to,
        value: amountWei,
        nonce,
        gasLimit,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas
      });
      const now = new Date().toISOString();
      const id = randomUUID();
      this.db
        .insert(withdrawals)
        .values({
          id,
          idempotencyKey: input.idempotencyKey ?? null,
          walletId: walletRow.id,
          fromAddress: signer.address,
          toAddress: to,
          amountWei: amountWei.toString(),
          nonce,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          gasLimit: gasLimit.toString(),
          maxFeePerGas: fees.maxFeePerGas.toString(),
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
          unsignedPayload: built.unsignedPayload,
          signedTransaction: built.signedTransaction,
          signatureR: built.signature.r,
          signatureS: built.signature.s,
          signatureYParity: built.signature.yParity,
          txHash: built.hash,
          state: "BUILT",
          createdAt: now,
          updatedAt: now
        })
        .run();

      return input.broadcast ? this.broadcast(id) : this.getById(id);
    });
  }

  async broadcast(id: string): Promise<WithdrawalRow> {
    const withdrawal = this.getById(id);
    if (["BROADCAST", "CONFIRMED", "REVERTED"].includes(withdrawal.state)) return withdrawal;

    try {
      const returnedHash = await this.gateway.broadcastTransaction(withdrawal.signedTransaction);
      if (returnedHash.toLowerCase() !== withdrawal.txHash.toLowerCase()) {
        throw new Error("RPC returned a transaction hash different from the signed payload hash");
      }
      this.markBroadcast(withdrawal);
      return this.getById(id);
    } catch (error) {
      const now = new Date().toISOString();
      this.db
        .update(withdrawals)
        .set({
          state: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Broadcast failed",
          updatedAt: now
        })
        .where(eq(withdrawals.id, id))
        .run();
      throw new UpstreamError("The signed transaction could not be broadcast");
    }
  }

  getById(id: string): WithdrawalRow {
    const withdrawal = this.db.select().from(withdrawals).where(eq(withdrawals.id, id)).get();
    if (!withdrawal) throw new NotFoundError("Withdrawal was not found");
    return withdrawal;
  }

  list(limit = 50): WithdrawalRow[] {
    return this.db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt)).limit(limit).all();
  }

  private markBroadcast(withdrawal: WithdrawalRow): void {
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.update(withdrawals)
        .set({ state: "BROADCAST", broadcastAt: now, errorMessage: null, updatedAt: now })
        .where(eq(withdrawals.id, withdrawal.id))
        .run();
      tx.insert(balanceChanges)
        .values({
          id: randomUUID(),
          walletId: withdrawal.walletId,
          kind: "WITHDRAWAL_BROADCAST",
          deltaWei: (-BigInt(withdrawal.amountWei)).toString(),
          txHash: withdrawal.txHash,
          withdrawalId: withdrawal.id,
          detectedAt: now
        })
        .onConflictDoNothing({ target: balanceChanges.withdrawalId })
        .run();
    });
  }

  private assertIdempotentMatch(existing: WithdrawalRow, input: CreateWithdrawalInput): void {
    const wallet = this.walletService.getWalletRow(input.walletIndex);
    let normalizedDestination: string;
    let amountWei: string;
    try {
      normalizedDestination = getAddress(input.to);
      amountWei = parseEther(input.amountEth).toString();
    } catch {
      throw new ValidationError("Destination or ETH amount is invalid");
    }
    if (
      !wallet ||
      existing.walletId !== wallet.id ||
      existing.toAddress !== normalizedDestination ||
      existing.amountWei !== amountWei
    ) {
      throw new ConflictError("Idempotency key has already been used for a different withdrawal");
    }
  }
}

export function serializeWithdrawal(row: WithdrawalRow, includeSignedPayload = true) {
  return {
    id: row.id,
    state: row.state,
    network: "base-sepolia",
    chainId: row.chainId,
    from: row.fromAddress,
    to: row.toAddress,
    amount: { wei: row.amountWei, eth: formatEther(row.amountWei) },
    transaction: {
      type: 2,
      nonce: row.nonce,
      gasLimit: row.gasLimit,
      maxFeePerGas: row.maxFeePerGas,
      maxPriorityFeePerGas: row.maxPriorityFeePerGas,
      data: "0x"
    },
    unsignedPayload: row.unsignedPayload,
    ...(includeSignedPayload ? { signedTransaction: row.signedTransaction } : {}),
    signature: {
      r: row.signatureR,
      s: row.signatureS,
      yParity: row.signatureYParity
    },
    txHash: row.txHash,
    actualFeeWei: row.actualFeeWei,
    error: row.errorMessage,
    createdAt: row.createdAt,
    broadcastAt: row.broadcastAt,
    confirmedAt: row.confirmedAt
  };
}

