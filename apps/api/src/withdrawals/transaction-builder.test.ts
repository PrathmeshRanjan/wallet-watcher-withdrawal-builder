import { HDNodeWallet, Transaction } from "ethers";
import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  buildSignedNativeTransfer,
} from "./transaction-builder.js";

const signer = HDNodeWallet.fromPhrase(
  "test test test test test test test test test test test junk",
  undefined,
  "m/44'/60'/0'/0/0",
);

describe("buildSignedNativeTransfer", () => {
  it("constructs a valid, recoverable EIP-1559 Base Sepolia transaction", async () => {
    const result = await buildSignedNativeTransfer({
      signer,
      to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      value: 1_000_000_000_000_001n,
      nonce: 4,
      gasLimit: 25_200n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
    });
    const parsed = Transaction.from(result.signedTransaction);

    expect(parsed.type).toBe(2);
    expect(parsed.chainId).toBe(BigInt(BASE_SEPOLIA_CHAIN_ID));
    expect(parsed.nonce).toBe(4);
    expect(parsed.value).toBe(1_000_000_000_000_001n);
    expect(parsed.from).toBe(signer.address);
    expect(parsed.hash).toBe(result.hash);
    expect(parsed.unsignedSerialized).toBe(result.unsignedPayload);
    expect(result.signature.r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.signature.s).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
