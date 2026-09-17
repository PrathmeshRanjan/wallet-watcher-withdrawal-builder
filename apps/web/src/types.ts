export type Wallet = {
  index: number;
  address: string;
  derivationPath: string;
  balance: { wei: string; eth: string };
  observedAt: string | null;
  blockNumber: number | null;
  blockHash: string | null;
  explorerUrl: string;
};

export type WalletsResponse = {
  network: string;
  chainId: number;
  asset: { symbol: string; decimals: number };
  stale: boolean;
  lastSuccessAt: string | null;
  wallets: Wallet[];
};

export type Withdrawal = {
  id: string;
  state: "BUILT" | "BROADCAST" | "CONFIRMED" | "FAILED" | "REVERTED";
  network: string;
  chainId: number;
  from: string;
  to: string;
  amount: { wei: string; eth: string };
  transaction: {
    type: number;
    nonce: number;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    data: string;
  };
  unsignedPayload: string;
  signedTransaction?: string;
  signature: { r: string; s: string; yParity: number };
  txHash: string;
  actualFeeWei: string | null;
  error: string | null;
  createdAt: string;
  broadcastAt: string | null;
  confirmedAt: string | null;
};

export type BalanceChange = {
  id: string;
  kind: "INITIAL_BALANCE" | "INFLOW" | "WITHDRAWAL_BROADCAST" | "UNCLASSIFIED_DECREASE";
  delta: { wei: string; eth: string };
  previousBalanceWei: string | null;
  newBalanceWei: string | null;
  blockNumber: number | null;
  txHash: string | null;
  detectedAt: string;
};

