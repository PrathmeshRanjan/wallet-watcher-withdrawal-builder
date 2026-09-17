# Vaultline — Wallet Watcher and Withdrawal Builder

A testnet-only custody backend slice for deterministic Base Sepolia wallets. Vaultline derives indexed wallets, persists block-pinned native ETH balances, records balance activity, and builds or broadcasts signed EIP-1559 withdrawals. A responsive operations dashboard and interactive OpenAPI documentation are included.

> **Safety:** Base Sepolia only. Never use a mnemonic that controls mainnet funds. The service rejects RPC endpoints that do not report chain ID `84532`.

## Architecture

```text
React operations dashboard
          │
          ▼
Fastify REST API ───── Withdrawal service ───── Base Sepolia JSON-RPC
          │                    │
          │             BIP-39 HD signer
          │
          ├──── Block-pinned balance tracker
          │
          ▼
SQLite (WAL) + versioned migrations
```

The API and tracker run in one process but are separate modules. This keeps the take-home easy to run while leaving a clean path to a dedicated worker and PostgreSQL in a larger deployment.

## Highlights

- Deterministic wallets at `m/44'/60'/0'/0/{index}`, with a configurable count from 1–20.
- Prefix stability: increasing the count adds indexes; decreasing it hides indexes without deleting history.
- All wallet balances are read at one exact block for a consistent snapshot.
- Immediate startup sync plus configurable 15–300 second polling; default 60 seconds.
- Lossless `bigint` handling. Wei is persisted as decimal text, never a JavaScript `number`.
- Type-2 EIP-1559 transactions with pending nonce, estimated gas plus a 20% margin, and a maximum-fee balance check.
- Build-only responses include the unsigned payload, raw signed transaction, structured signature, and precomputed hash.
- Broadcast state machine with idempotency keys, recovery of uncertain broadcasts, and receipt tracking.
- No outflow is created for a build-only withdrawal. The outflow is inserted only after an RPC broadcast succeeds or an already-broadcast hash is recovered.
- Optional bearer protection for mutating endpoints.
- React dashboard, BaseScan links, OpenAPI UI, Docker support, and deterministic tests.

## Requirements

- Node.js 24 LTS
- pnpm 11
- A Base Sepolia RPC URL. The public Base endpoint is the default; a dedicated provider is recommended for reliable testing.
- Base Sepolia ETH for any wallet used to broadcast a transaction.

## Quick start

```bash
pnpm install
pnpm setup
pnpm dev
```

`pnpm setup` creates a testnet-only mnemonic in `.env`, sets file permissions to `0600`, and refuses to overwrite an existing file. `.env` is ignored by Git.

Open:

- Dashboard: http://localhost:5173
- API: http://127.0.0.1:3000/api/v1
- OpenAPI UI: http://127.0.0.1:3000/docs

The Vite development server proxies `/api` and `/docs` to Fastify. In production, Fastify serves the built dashboard from the same process.

## Environment variables

| Variable                | Required | Default                    | Description                                                                          |
| ----------------------- | -------: | -------------------------- | ------------------------------------------------------------------------------------ |
| `HD_MNEMONIC`           |      Yes | —                          | Testnet-only BIP-39 mnemonic used to derive and sign all managed wallets.            |
| `BASE_SEPOLIA_RPC_URL`  |       No | `https://sepolia.base.org` | HTTP JSON-RPC endpoint. Chain ID is verified before tracking or withdrawal creation. |
| `WALLET_COUNT`          |       No | `3`                        | Active wallet count; integer from 1 through 20.                                      |
| `POLL_INTERVAL_SECONDS` |       No | `60`                       | Tracking interval; constrained to 15–300 seconds.                                    |
| `DATABASE_PATH`         |       No | `./data/wallet-watcher.db` | SQLite database path.                                                                |
| `HOST`                  |       No | `127.0.0.1`                | API bind host. Use `0.0.0.0` in a container.                                         |
| `PORT`                  |       No | `3000`                     | API port.                                                                            |
| `LOG_LEVEL`             |       No | `info`                     | Pino log level.                                                                      |
| `ADMIN_API_KEY`         |       No | —                          | When set, POST endpoints require `Authorization: Bearer …`. Minimum 12 characters.   |
| `CORS_ORIGINS`          |       No | `http://localhost:5173`    | Comma-separated allowed browser origins.                                             |

Changing `HD_MNEMONIC` while reusing a populated database is rejected because it would silently associate old history with new addresses. Use the original mnemonic or a fresh database.

## API

### List wallets

```http
GET /api/v1/wallets
```

Returns addresses, derivation paths, exact wei and formatted ETH balances, observation block metadata, freshness, and BaseScan URLs.

### Build or broadcast a withdrawal

```http
POST /api/v1/withdrawals
Content-Type: application/json
Idempotency-Key: a-client-generated-unique-value

{
  "walletIndex": 0,
  "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "amountEth": "0.001",
  "broadcast": false
}
```

`amountEth` must be a JSON string with at most 18 decimal places. Set `broadcast` to `false` to receive a signed transaction without sending it, or `true` to submit it to Base Sepolia and record the outflow.

A previously built transaction can be broadcast with:

```http
POST /api/v1/withdrawals/{id}/broadcast
```

### Other endpoints

```text
GET  /api/v1/health
GET  /api/v1/wallets/{index}/changes
GET  /api/v1/withdrawals
GET  /api/v1/withdrawals/{id}
POST /api/v1/tracking/sync
```

If `ADMIN_API_KEY` is configured, include it on POST requests:

```http
Authorization: Bearer your-api-key
```

## Balance and deposit behavior

The tracker polls native ETH balances rather than indexing deposit transactions. On every run it first selects one current block, then reads every wallet at that block. Current balances, the block hash, block number, and observation timestamp are persisted atomically.

### Multiple deposits in one polling interval

If several deposits reach one wallet between observations, the service records one aggregate `INFLOW` equal to the positive balance difference. It intentionally does not create one record per deposit transaction or consolidate funds into another address.

### Service downtime

The database retains the last successful balance. On restart, an immediate sync compares that persisted value with the new on-chain value and records the aggregate difference. The health endpoint reports `degraded` when no successful sync has occurred in ten minutes, so an RPC outage is visible rather than silently presenting old data as current.

The first observation establishes a baseline. A non-zero first observation is labeled `INITIAL_BALANCE`, not a deposit that the service can prove occurred while it was watching.

### Limits of balance-difference tracking

Polling observes net state. Deposits and unrelated activity within the same interval may offset one another, so the system does not claim transaction-level deposit attribution. Broadcasts initiated by this service are recorded explicitly as `WITHDRAWAL_BROADCAST`. Other negative balance movements are retained as `UNCLASSIFIED_DECREASE`, not mislabeled as withdrawals.

## Withdrawal lifecycle

```text
BUILT ──broadcast accepted──► BROADCAST ──receipt status 1──► CONFIRMED
  │                              └────────receipt status 0──► REVERTED
  └────────broadcast error──────────────────────────────────► FAILED
```

The signed transaction is stored before broadcasting. Its hash is deterministic, so a startup reconciliation can detect a transaction that reached the node even if the client lost the original response. A unique withdrawal ID and optional idempotency key prevent duplicate outflow records.

## Testing

Run the full local verification suite:

```bash
pnpm check
```

Individual commands:

```bash
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm build
pnpm format:check
```

Tests use a fake Base gateway and in-memory SQLite database. They do not require funds, secrets, or network connectivity. Coverage includes deterministic derivation vectors, prefix stability, database identity protection, signed-transaction recovery, 18-decimal precision, fee reservation, build-only semantics, idempotent broadcast logging, pinned-block balance reads, and aggregate inflows.

### Manual Base Sepolia walkthrough

1. Run `pnpm setup`, then `pnpm dev`.
2. Open the dashboard and copy Wallet 1’s address.
3. Fund it from a Base Sepolia faucet linked from the [official Base faucet guide](https://docs.base.org/base-chain/tools/network-faucets).
4. Click **Sync now** or wait for the next poll. The balance and inflow should appear.
5. Choose **New withdrawal** and select **Build only**. Inspect the returned hash, signature, and raw transaction. No outflow should appear.
6. Create another withdrawal with **Build & broadcast**. Verify its BaseScan link and the `WITHDRAWAL_BROADCAST` activity entry.
7. After the next poll, confirm the wallet balance and receipt state update.

Use a second generated wallet as the destination so the inflow and outflow are both visible in the dashboard.

## Docker

After creating `.env`:

```bash
docker compose up --build
```

The combined production application is served at http://localhost:3000 and SQLite data is retained in the `vaultline-data` volume.

## Security choices

- Mnemonics and private keys are never stored in SQLite, returned from APIs, or logged.
- `.env`, SQLite files, build output, and coverage files are ignored by Git.
- Signing occurs locally with a key derived only when needed.
- The RPC chain ID is pinned to Base Sepolia.
- Signed raw transactions authorize one exact transfer but remain sensitive until mined or superseded; API access should be protected outside local development.
- The API binds to loopback by default and supports optional bearer authentication for all mutation routes.
- This repository and its generated credentials are for testnet use only.

## Project structure

```text
apps/
  api/  Fastify API, wallet derivation, tracking, signing, persistence, tests
  web/  React operations dashboard
```

## Deliberate trade-offs

- SQLite is appropriate for 1–20 wallets and a single service instance. Multi-instance operation would use PostgreSQL plus a distributed polling lock.
- Polling is the source of truth. Webhooks would improve latency but add provider coupling, public callback infrastructure, duplicate delivery, and catch-up logic without eliminating reconciliation.
- Native ETH keeps the assignment to one asset. ERC-20 support would also require ETH gas management.
- The in-process per-wallet lock prevents concurrent nonce selection in this service instance. A distributed deployment would use database-backed nonce reservation.
