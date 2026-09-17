import type Database from "better-sqlite3";

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_index INTEGER NOT NULL UNIQUE,
        address TEXT NOT NULL UNIQUE,
        derivation_path TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_balances (
        wallet_id INTEGER PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
        balance_wei TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount_wei TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        chain_id INTEGER NOT NULL,
        gas_limit TEXT NOT NULL,
        max_fee_per_gas TEXT NOT NULL,
        max_priority_fee_per_gas TEXT NOT NULL,
        unsigned_payload TEXT NOT NULL,
        signed_transaction TEXT NOT NULL,
        signature_r TEXT NOT NULL,
        signature_s TEXT NOT NULL,
        signature_y_parity INTEGER NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('BUILT','BROADCAST','CONFIRMED','FAILED','REVERTED')),
        error_message TEXT,
        broadcast_at TEXT,
        confirmed_at TEXT,
        actual_fee_wei TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS withdrawals_wallet_id_index ON withdrawals(wallet_id);
      CREATE INDEX IF NOT EXISTS withdrawals_state_index ON withdrawals(state);

      CREATE TABLE IF NOT EXISTS balance_changes (
        id TEXT PRIMARY KEY,
        wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('INITIAL_BALANCE','INFLOW','WITHDRAWAL_BROADCAST','UNCLASSIFIED_DECREASE')),
        delta_wei TEXT NOT NULL,
        previous_balance_wei TEXT,
        new_balance_wei TEXT,
        block_number INTEGER,
        tx_hash TEXT,
        withdrawal_id TEXT UNIQUE REFERENCES withdrawals(id) ON DELETE SET NULL,
        detected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS balance_changes_wallet_id_index ON balance_changes(wallet_id);

      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        block_number INTEGER,
        status TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT
      );
    `
  }
] as const;

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    sqlite
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version)
  );

  const apply = sqlite.transaction((version: number, sql: string) => {
    sqlite.exec(sql);
    sqlite
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(version, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!applied.has(migration.version)) apply(migration.version, migration.sql);
  }
}

