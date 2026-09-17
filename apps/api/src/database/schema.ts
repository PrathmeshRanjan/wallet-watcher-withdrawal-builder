import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const wallets = sqliteTable(
  "wallets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    walletIndex: integer("wallet_index").notNull(),
    address: text("address").notNull(),
    derivationPath: text("derivation_path").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("wallets_wallet_index_unique").on(table.walletIndex),
    uniqueIndex("wallets_address_unique").on(table.address),
  ],
);

export const walletBalances = sqliteTable("wallet_balances", {
  walletId: integer("wallet_id")
    .primaryKey()
    .references(() => wallets.id, { onDelete: "cascade" }),
  balanceWei: text("balance_wei").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  observedAt: text("observed_at").notNull(),
});

export const withdrawals = sqliteTable(
  "withdrawals",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key"),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountWei: text("amount_wei").notNull(),
    nonce: integer("nonce").notNull(),
    chainId: integer("chain_id").notNull(),
    gasLimit: text("gas_limit").notNull(),
    maxFeePerGas: text("max_fee_per_gas").notNull(),
    maxPriorityFeePerGas: text("max_priority_fee_per_gas").notNull(),
    unsignedPayload: text("unsigned_payload").notNull(),
    signedTransaction: text("signed_transaction").notNull(),
    signatureR: text("signature_r").notNull(),
    signatureS: text("signature_s").notNull(),
    signatureYParity: integer("signature_y_parity").notNull(),
    txHash: text("tx_hash").notNull(),
    state: text("state", {
      enum: ["BUILT", "BROADCAST", "CONFIRMED", "FAILED", "REVERTED"],
    }).notNull(),
    errorMessage: text("error_message"),
    broadcastAt: text("broadcast_at"),
    confirmedAt: text("confirmed_at"),
    actualFeeWei: text("actual_fee_wei"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("withdrawals_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("withdrawals_tx_hash_unique").on(table.txHash),
    index("withdrawals_wallet_id_index").on(table.walletId),
    index("withdrawals_state_index").on(table.state),
  ],
);

export const balanceChanges = sqliteTable(
  "balance_changes",
  {
    id: text("id").primaryKey(),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "INITIAL_BALANCE",
        "INFLOW",
        "WITHDRAWAL_BROADCAST",
        "UNCLASSIFIED_DECREASE",
      ],
    }).notNull(),
    deltaWei: text("delta_wei").notNull(),
    previousBalanceWei: text("previous_balance_wei"),
    newBalanceWei: text("new_balance_wei"),
    blockNumber: integer("block_number"),
    txHash: text("tx_hash"),
    withdrawalId: text("withdrawal_id").references(() => withdrawals.id, {
      onDelete: "set null",
    }),
    detectedAt: text("detected_at").notNull(),
  },
  (table) => [
    index("balance_changes_wallet_id_index").on(table.walletId),
    uniqueIndex("balance_changes_withdrawal_id_unique").on(table.withdrawalId),
  ],
);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  blockNumber: integer("block_number"),
  status: text("status", {
    enum: ["RUNNING", "SUCCEEDED", "FAILED"],
  }).notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  errorMessage: text("error_message"),
});

export type WalletRow = typeof wallets.$inferSelect;
export type WithdrawalRow = typeof withdrawals.$inferSelect;
