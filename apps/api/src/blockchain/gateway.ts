import { JsonRpcProvider, type TransactionReceipt } from "ethers";

export type BlockReference = { number: number; hash: string };
export type FeeQuote = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
export type ReceiptSummary = {
  status: number | null;
  blockNumber: number;
  gasUsed: bigint;
  gasPrice: bigint;
};

export interface ChainGateway {
  getChainId(): Promise<bigint>;
  getLatestBlock(): Promise<BlockReference>;
  getBalance(address: string, blockNumber?: number): Promise<bigint>;
  getPendingNonce(address: string): Promise<number>;
  getFeeQuote(): Promise<FeeQuote>;
  estimateNativeTransferGas(
    from: string,
    to: string,
    value: bigint,
  ): Promise<bigint>;
  broadcastTransaction(signedTransaction: string): Promise<string>;
  transactionExists(hash: string): Promise<boolean>;
  getReceipt(hash: string): Promise<ReceiptSummary | null>;
}

export class EthersChainGateway implements ChainGateway {
  private readonly provider: JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: false,
    });
  }

  async getChainId(): Promise<bigint> {
    return (await this.provider.getNetwork()).chainId;
  }

  async getLatestBlock(): Promise<BlockReference> {
    const block = await this.provider.getBlock("latest");
    if (!block || !block.hash)
      throw new Error("RPC did not return a canonical latest block");
    return { number: block.number, hash: block.hash };
  }

  getBalance(address: string, blockNumber?: number): Promise<bigint> {
    return this.provider.getBalance(address, blockNumber ?? "latest");
  }

  getPendingNonce(address: string): Promise<number> {
    return this.provider.getTransactionCount(address, "pending");
  }

  async getFeeQuote(): Promise<FeeQuote> {
    const fees = await this.provider.getFeeData();
    if (fees.maxFeePerGas === null || fees.maxPriorityFeePerGas === null) {
      throw new Error("RPC did not return EIP-1559 fee data");
    }
    return {
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  }

  estimateNativeTransferGas(
    from: string,
    to: string,
    value: bigint,
  ): Promise<bigint> {
    return this.provider.estimateGas({ from, to, value, data: "0x" });
  }

  async broadcastTransaction(signedTransaction: string): Promise<string> {
    return (await this.provider.broadcastTransaction(signedTransaction)).hash;
  }

  async transactionExists(hash: string): Promise<boolean> {
    return (await this.provider.getTransaction(hash)) !== null;
  }

  async getReceipt(hash: string): Promise<ReceiptSummary | null> {
    const receipt: TransactionReceipt | null =
      await this.provider.getTransactionReceipt(hash);
    if (!receipt) return null;
    return {
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      gasPrice: receipt.gasPrice,
    };
  }
}
