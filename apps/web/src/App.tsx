import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Blocks,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Code2,
  ExternalLink,
  Eye,
  KeyRound,
  LoaderCircle,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "./api";
import type { BalanceChange, Wallet, Withdrawal } from "./types";

const shortAddress = (value: string) => `${value.slice(0, 7)}…${value.slice(-5)}`;
const relativeTime = (value: string | null) => {
  if (!value) return "Awaiting first sync";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};
const displayEth = (value: string) => {
  const amount = Number(value);
  if (amount === 0) return "0.0000";
  if (amount < 0.0001) return "< 0.0001";
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button"
      aria-label="Copy to clipboard"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_200);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Clipboard size={14} />}
    </button>
  );
}

function WalletCard({ wallet, selected, onSelect }: { wallet: Wallet; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`wallet-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="wallet-card-top">
        <span className="wallet-index">W{String(wallet.index + 1).padStart(2, "0")}</span>
        <span className="wallet-path">{wallet.derivationPath.split("/").at(-1)}</span>
      </div>
      <div className="balance-row">
        <span className="balance-value">{displayEth(wallet.balance.eth)}</span>
        <span className="balance-unit">ETH</span>
      </div>
      <div className="address-row">
        <span>{shortAddress(wallet.address)}</span>
        <CopyButton value={wallet.address} />
      </div>
      <div className="wallet-card-footer">
        <span>{relativeTime(wallet.observedAt)}</span>
        <ChevronRight size={15} />
      </div>
    </button>
  );
}

function ChangeIcon({ change }: { change: BalanceChange }) {
  if (change.kind === "INFLOW" || change.kind === "INITIAL_BALANCE") return <ArrowDownLeft size={16} />;
  if (change.kind === "WITHDRAWAL_BROADCAST") return <ArrowUpRight size={16} />;
  return <CircleAlert size={16} />;
}

function ActivityFeed({ walletIndex }: { walletIndex: number }) {
  const changes = useQuery({
    queryKey: ["changes", walletIndex],
    queryFn: () => api.changes(walletIndex),
    refetchInterval: 15_000
  });
  const labels: Record<BalanceChange["kind"], string> = {
    INITIAL_BALANCE: "Opening balance",
    INFLOW: "Deposit detected",
    WITHDRAWAL_BROADCAST: "Withdrawal broadcast",
    UNCLASSIFIED_DECREASE: "Balance reconciled"
  };

  if (changes.isLoading) return <div className="panel-empty">Loading activity…</div>;
  if (!changes.data?.changes.length) {
    return (
      <div className="panel-empty">
        <Activity size={22} />
        <span>No balance changes yet</span>
      </div>
    );
  }

  return (
    <div className="activity-list">
      {changes.data.changes.map((change) => {
        const positive = !change.delta.eth.startsWith("-");
        return (
          <div className="activity-item" key={change.id}>
            <div className={`activity-icon ${positive ? "positive" : "negative"}`}>
              <ChangeIcon change={change} />
            </div>
            <div className="activity-copy">
              <strong>{labels[change.kind]}</strong>
              <span>{new Date(change.detectedAt).toLocaleString()}</span>
            </div>
            <div className={`activity-amount ${positive ? "positive" : "negative"}`}>
              {positive ? "+" : ""}{displayEth(change.delta.eth)} ETH
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WithdrawalModal({
  wallet,
  onClose,
  apiKey
}: {
  wallet: Wallet;
  onClose: () => void;
  apiKey: string;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [broadcast, setBroadcast] = useState(false);
  const [result, setResult] = useState<Withdrawal | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api.createWithdrawal({
        walletIndex: wallet.index,
        to,
        amountEth: amount,
        broadcast,
        ...(apiKey ? { apiKey } : {})
      }),
    onSuccess: (value) => {
      setResult(value);
      void queryClient.invalidateQueries({ queryKey: ["withdrawals"] });
      void queryClient.invalidateQueries({ queryKey: ["changes", wallet.index] });
    }
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">Wallet {wallet.index + 1}</span>
            <h2>{result ? "Transaction ready" : "Create withdrawal"}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>

        {result ? (
          <div className="result-view">
            <div className={`result-status ${result.state.toLowerCase()}`}>
              {result.state === "BUILT" ? <Code2 size={20} /> : <Radio size={20} />}
              <div>
                <strong>{result.state === "BUILT" ? "Signed, not broadcast" : result.state}</strong>
                <span>{result.amount.eth} ETH to {shortAddress(result.to)}</span>
              </div>
            </div>
            <div className="payload-section">
              <div className="payload-title"><span>Transaction hash</span><CopyButton value={result.txHash} /></div>
              <code>{result.txHash}</code>
            </div>
            {result.signedTransaction && (
              <div className="payload-section">
                <div className="payload-title"><span>Signed raw transaction</span><CopyButton value={result.signedTransaction} /></div>
                <code>{result.signedTransaction}</code>
              </div>
            )}
            <div className="signature-grid">
              <div><span>Nonce</span><strong>{result.transaction.nonce}</strong></div>
              <div><span>Gas limit</span><strong>{result.transaction.gasLimit}</strong></div>
              <div><span>Signature parity</span><strong>{result.signature.yParity}</strong></div>
            </div>
            <a className="primary-button" href={`https://sepolia.basescan.org/tx/${result.txHash}`} target="_blank" rel="noreferrer">
              View on BaseScan <ExternalLink size={16} />
            </a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="source-summary">
              <div className="source-avatar"><WalletCards size={19} /></div>
              <div><span>From</span><strong>{shortAddress(wallet.address)}</strong></div>
              <div className="source-balance"><span>Available</span><strong>{displayEth(wallet.balance.eth)} ETH</strong></div>
            </div>
            <label>
              Destination address
              <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" required />
            </label>
            <label>
              Amount
              <div className="amount-input"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.001" inputMode="decimal" required /><span>ETH</span></div>
            </label>
            <div className="mode-selector">
              <button type="button" className={!broadcast ? "active" : ""} onClick={() => setBroadcast(false)}>
                <Eye size={17} /><span><strong>Build only</strong><small>Sign without sending</small></span>
              </button>
              <button type="button" className={broadcast ? "active danger" : ""} onClick={() => setBroadcast(true)}>
                <Send size={17} /><span><strong>Build & broadcast</strong><small>Send on Base Sepolia</small></span>
              </button>
            </div>
            <div className="safety-note"><ShieldCheck size={17} /><span>Testnet only. The service reserves enough balance for the maximum estimated network fee.</span></div>
            {mutation.error && <div className="form-error"><CircleAlert size={16} />{mutation.error.message}</div>}
            <button className={`primary-button ${broadcast ? "broadcast" : ""}`} disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle className="spin" size={17} /> : broadcast ? <Send size={17} /> : <Code2 size={17} />}
              {mutation.isPending ? "Preparing…" : broadcast ? "Sign & broadcast" : "Build signed transaction"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function WithdrawalList({ withdrawals }: { withdrawals: Withdrawal[] }) {
  if (!withdrawals.length) return <div className="panel-empty"><Send size={22} /><span>No withdrawals built yet</span></div>;
  return (
    <div className="withdrawal-list">
      {withdrawals.slice(0, 6).map((item) => (
        <a key={item.id} className="withdrawal-item" href={`https://sepolia.basescan.org/tx/${item.txHash}`} target="_blank" rel="noreferrer">
          <div className="withdrawal-arrow"><ArrowUpRight size={16} /></div>
          <div className="withdrawal-copy"><strong>{item.amount.eth} ETH</strong><span>{shortAddress(item.to)}</span></div>
          <span className={`status-pill ${item.state.toLowerCase()}`}>{item.state}</span>
        </a>
      ))}
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: api.wallets, refetchInterval: 15_000 });
  const withdrawals = useQuery({ queryKey: ["withdrawals"], queryFn: api.withdrawals, refetchInterval: 15_000 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedWallet = wallets.data?.wallets.find((wallet) => wallet.index === selectedIndex) ?? wallets.data?.wallets[0];
  const total = useMemo(
    () => wallets.data?.wallets.reduce((sum, wallet) => sum + Number(wallet.balance.eth), 0) ?? 0,
    [wallets.data]
  );
  const sync = useMutation({
    mutationFn: () => api.sync(apiKey || undefined),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["wallets"] })
  });

  if (wallets.isLoading) {
    return <main className="loading-screen"><div className="brand-mark"><Blocks size={24} /></div><LoaderCircle className="spin" /><span>Opening the vault…</span></main>;
  }

  if (wallets.error || !wallets.data) {
    return <main className="loading-screen error-screen"><CircleAlert /><h1>Couldn’t reach the wallet service</h1><p>{wallets.error?.message}</p><button className="primary-button" onClick={() => wallets.refetch()}>Try again</button></main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Blocks size={22} /></div><div><strong>Vaultline</strong><span>Wallet operations</span></div></div>
        <div className="topbar-actions">
          <div className={`network-pill ${wallets.data.stale ? "stale" : ""}`}><span className="network-dot" />Base Sepolia <small>84532</small></div>
          <button className="secondary-button" onClick={() => setSettingsOpen(!settingsOpen)}><KeyRound size={16} />Access</button>
          <button className="secondary-button" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={sync.isPending ? "spin" : ""} size={16} />Sync now</button>
        </div>
      </header>

      {settingsOpen && (
        <div className="access-bar"><KeyRound size={16} /><span>Optional API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Only needed when ADMIN_API_KEY is configured" /><button onClick={() => setSettingsOpen(false)}>Done</button></div>
      )}

      <section className="hero">
        <div><span className="eyebrow"><Sparkles size={13} /> Testnet custody workspace</span><h1>Every wallet.<br /><em>One clear view.</em></h1><p>Deterministic accounts, block-pinned balances, and controlled withdrawals on Base Sepolia.</p></div>
        <div className="hero-stats">
          <div><span>Combined balance</span><strong>{total.toLocaleString(undefined, { maximumFractionDigits: 6 })}</strong><small>ETH</small></div>
          <div><span>Managed wallets</span><strong>{wallets.data.wallets.length}</strong><small>active</small></div>
          <div><span>Last reconciliation</span><strong className="stat-time">{relativeTime(wallets.data.lastSuccessAt)}</strong><small>{wallets.data.stale ? "stale" : "healthy"}</small></div>
        </div>
      </section>

      <section className="content-grid">
        <div className="wallets-section">
          <div className="section-heading"><div><span className="eyebrow">Accounts</span><h2>Managed wallets</h2></div><span className="section-count">{wallets.data.wallets.length} / 20</span></div>
          <div className="wallet-grid">{wallets.data.wallets.map((wallet) => <WalletCard key={wallet.index} wallet={wallet} selected={selectedWallet?.index === wallet.index} onSelect={() => setSelectedIndex(wallet.index)} />)}</div>
        </div>

        {selectedWallet && (
          <aside className="wallet-detail">
            <div className="detail-header"><div><span className="eyebrow">Selected account</span><h2>Wallet {selectedWallet.index + 1}</h2></div><a className="icon-button" href={selectedWallet.explorerUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a></div>
            <div className="detail-balance"><span>Available balance</span><div><strong>{displayEth(selectedWallet.balance.eth)}</strong><em>ETH</em></div></div>
            <div className="detail-address"><span>Address</span><div><code>{shortAddress(selectedWallet.address)}</code><CopyButton value={selectedWallet.address} /></div></div>
            <div className="detail-metadata"><div><span>Derivation</span><strong>{selectedWallet.derivationPath}</strong></div><div><span>Observed block</span><strong>{selectedWallet.blockNumber?.toLocaleString() ?? "Pending"}</strong></div></div>
            <button className="primary-button" onClick={() => setWithdrawOpen(true)}><Send size={17} />New withdrawal</button>
          </aside>
        )}
      </section>

      {selectedWallet && (
        <section className="lower-grid">
          <div className="panel"><div className="panel-header"><div><span className="eyebrow">Ledger</span><h2>Balance activity</h2></div><Activity size={18} /></div><ActivityFeed walletIndex={selectedWallet.index} /></div>
          <div className="panel"><div className="panel-header"><div><span className="eyebrow">Transactions</span><h2>Recent withdrawals</h2></div><Send size={18} /></div><WithdrawalList withdrawals={withdrawals.data?.withdrawals ?? []} /></div>
        </section>
      )}

      <footer><div><ShieldCheck size={15} />Testnet-only key material</div><div><a href="/docs" target="_blank">API documentation <ExternalLink size={13} /></a><span>•</span><span>Polling every 60 seconds</span></div></footer>

      {withdrawOpen && selectedWallet && <WithdrawalModal wallet={selectedWallet} apiKey={apiKey} onClose={() => setWithdrawOpen(false)} />}
    </main>
  );
}

