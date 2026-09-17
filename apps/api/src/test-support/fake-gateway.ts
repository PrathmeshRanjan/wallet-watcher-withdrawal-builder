import type {
  BlockReference,
  ChainGateway,
  FeeQuote,
  ReceiptSummary,
} from "../blockchain/gateway.js";

export class FakeGateway implements ChainGateway {
  chainId = 84_532n;
  block: BlockReference = { number: 10_000, hash: `0x${"ab".repeat(32)}` };
  balances = new Map<string, bigint>();
  balanceReads: Array<{ address: string; blockNumber?: number }> = [];
  nonce = 7;
  fees: FeeQuote = {
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  };
  gasEstimate = 21_000n;
  broadcasted: string[] = [];
  knownTransactions = new Set<string>();
  receipts = new Map<string, ReceiptSummary>();

  async getChainId() {
    return this.chainId;
  }

  async getLatestBlock() {
    return this.block;
  }

  async getBalance(address: string, blockNumber?: number) {
    this.balanceReads.push({
      address,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  async getPendingNonce() {
    return this.nonce;
  }

  async getFeeQuote() {
    return this.fees;
  }

  async estimateNativeTransferGas() {
    return this.gasEstimate;
  }

  async broadcastTransaction(signedTransaction: string) {
    const { Transaction } = await import("ethers");
    const hash = Transaction.from(signedTransaction).hash!;
    this.broadcasted.push(signedTransaction);
    this.knownTransactions.add(hash);
    return hash;
  }

  async transactionExists(hash: string) {
    return this.knownTransactions.has(hash);
  }

  async getReceipt(hash: string) {
    return this.receipts.get(hash) ?? null;
  }
}
