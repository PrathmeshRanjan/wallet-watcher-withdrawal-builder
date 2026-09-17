import { Transaction, type HDNodeWallet } from "ethers";

export const BASE_SEPOLIA_CHAIN_ID = 84_532;

export type NativeTransferInput = {
  signer: HDNodeWallet;
  to: string;
  value: bigint;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  chainId?: number;
};

export type BuiltNativeTransfer = {
  transaction: {
    type: 2;
    chainId: number;
    nonce: number;
    from: string;
    to: string;
    valueWei: string;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    data: "0x";
  };
  unsignedPayload: string;
  signedTransaction: string;
  signature: { r: string; s: string; yParity: number };
  hash: string;
};

export async function buildSignedNativeTransfer(
  input: NativeTransferInput,
): Promise<BuiltNativeTransfer> {
  const chainId = input.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const request = {
    type: 2,
    chainId,
    nonce: input.nonce,
    to: input.to,
    value: input.value,
    gasLimit: input.gasLimit,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    data: "0x",
  } as const;

  const signedTransaction = await input.signer.signTransaction(request);
  const parsed = Transaction.from(signedTransaction);
  if (
    !parsed.signature ||
    !parsed.hash ||
    parsed.from?.toLowerCase() !== input.signer.address.toLowerCase()
  ) {
    throw new Error("Signed transaction failed signer verification");
  }

  return {
    transaction: {
      type: 2,
      chainId,
      nonce: input.nonce,
      from: input.signer.address,
      to: input.to,
      valueWei: input.value.toString(),
      gasLimit: input.gasLimit.toString(),
      maxFeePerGas: input.maxFeePerGas.toString(),
      maxPriorityFeePerGas: input.maxPriorityFeePerGas.toString(),
      data: "0x",
    },
    unsignedPayload: parsed.unsignedSerialized,
    signedTransaction,
    signature: {
      r: parsed.signature.r,
      s: parsed.signature.s,
      yParity: parsed.signature.yParity,
    },
    hash: parsed.hash,
  };
}
