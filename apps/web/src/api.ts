import type { BalanceChange, WalletsResponse, Withdrawal } from "./types";

const API_BASE = "/api/v1";

type ApiErrorBody = { error?: { message?: string } };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  wallets: () => request<WalletsResponse>("/wallets"),
  withdrawals: () => request<{ withdrawals: Withdrawal[] }>("/withdrawals"),
  changes: (walletIndex: number) =>
    request<{ wallet: { index: number; address: string }; changes: BalanceChange[] }>(
      `/wallets/${walletIndex}/changes`
    ),
  sync: (apiKey?: string) =>
    request<{ completed: boolean }>("/tracking/sync", {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    }),
  createWithdrawal: (input: {
    walletIndex: number;
    to: string;
    amountEth: string;
    broadcast: boolean;
    apiKey?: string;
  }) =>
    request<Withdrawal>("/withdrawals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
      },
      body: JSON.stringify({
        walletIndex: input.walletIndex,
        to: input.to,
        amountEth: input.amountEth,
        broadcast: input.broadcast
      })
    })
};

