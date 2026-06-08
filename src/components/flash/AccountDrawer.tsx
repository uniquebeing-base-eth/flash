import { useEffect, useState, useCallback } from "react";
import { Drawer } from "./Drawer";
import { User, ChevronDown, TrendingUp, TrendingDown, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getVaultBalance, getWalletCusdBalance } from "@/lib/flashVault";
import {
  bridgeDeposit,
  quoteDeposit,
  SQUID_INTEGRATOR_ID,
  type BridgeQuote,
  type DepositRecord,
} from "@/lib/squidBridge";
import {
  bridgeWithdraw,
  quoteWithdraw,
  getArbUsdcBalance,
  type WithdrawRecord,
  type WithdrawQuote,
} from "@/lib/withdrawBridge";
import { DEPOSIT_FEE_USD, WITHDRAW_FEE_USD, CELO_FEE_TREASURY, ARB_FEE_TREASURY } from "@/lib/fees";

interface Session { wallet: string; username: string; }

export function AccountDrawer({ open, onClose, session }: { open: boolean; onClose: () => void; session: Session }) {
  const [tab, setTab] = useState<"profile" | "wallet" | "settings">("wallet");
  return (
    <Drawer open={open} onClose={onClose} title="ACCOUNT" icon={<User className="w-7 h-7" strokeWidth={2.5} />}>
      <div className="grid grid-cols-3 gap-0 box-sm mb-4 p-1">
        {(["profile", "wallet", "settings"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-3 text-xs font-bold tracking-wider uppercase ${tab === t ? "bg-foreground text-background" : "bg-card"}`}>{t}</button>
        ))}
      </div>

      {tab === "wallet" && <WalletTab session={session} />}
      {tab === "profile" && <ProfileTab session={session} />}
      {tab === "settings" && <SettingsTab />}
    </Drawer>
  );
}

function WalletTab({ session }: { session: Session }) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [vaultBal, setVaultBal] = useState("0");
  const [walletBal, setWalletBal] = useState("0");
  const [arbUsdcBal, setArbUsdcBal] = useState("0");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [wQuote, setWQuote] = useState<WithdrawQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [activeDeposit, setActiveDeposit] = useState<DepositRecord | null>(null);
  const [activeWithdraw, setActiveWithdraw] = useState<WithdrawRecord | null>(null);

  const refresh = useCallback(async () => {
    const [v, w, a] = await Promise.allSettled([
      getVaultBalance(session.wallet),
      getWalletCusdBalance(session.wallet),
      getArbUsdcBalance(session.wallet),
    ]);
    if (v.status === "fulfilled") setVaultBal(v.value);
    if (w.status === "fulfilled") setWalletBal(w.value);
    if (a.status === "fulfilled") setArbUsdcBal(a.value);
  }, [session.wallet]);

  useEffect(() => { refresh(); }, [refresh]);

  const max = mode === "deposit" ? walletBal : arbUsdcBal;
  const num = parseFloat(amount || "0");
  const valid = num > 0 && num <= parseFloat(max || "0");

  // Debounced Squid quote
  useEffect(() => {
    if (!valid || !SQUID_INTEGRATOR_ID) {
      setQuote(null); setWQuote(null);
      return;
    }
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        if (mode === "deposit") {
          const q = await quoteDeposit(amount); setQuote(q); setWQuote(null);
        } else {
          const q = await quoteWithdraw(amount, session.wallet); setWQuote(q); setQuote(null);
        }
      } catch {
        setQuote(null); setWQuote(null);
      } finally {
        setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [amount, mode, valid, session.wallet]);

  const submit = async () => {
    if (!valid) return;
    if (!SQUID_INTEGRATOR_ID) {
      toast.error("Bridge not configured. Set VITE_SQUID_INTEGRATOR_ID.");
      return;
    }
    if (mode === "deposit" && !CELO_FEE_TREASURY) {
      toast.error("Deposit fee treasury not set. Configure VITE_CELO_FEE_TREASURY.");
      return;
    }
    if (mode === "withdraw" && !ARB_FEE_TREASURY) {
      toast.error("Withdraw fee treasury not set. Configure VITE_ARB_FEE_TREASURY.");
      return;
    }
    setBusy(true);
    setLastTx(null);
    try {
      toast.loading(
        mode === "deposit" ? "Bridging cUSD → Arbitrum USDC…" : "Bridging USDC → Celo cUSD…",
        { id: "vtx" }
      );
      if (mode === "deposit") {
        const rec = await bridgeDeposit(amount, { onStatus: setActiveDeposit });
        setActiveDeposit(rec);
        setLastTx(rec.bridgeTxHash ?? rec.feeTxHash ?? null);
        toast.success("Bridge submitted — tracking status", { id: "vtx" });
      } else {
        const rec = await bridgeWithdraw(amount, session.wallet, { onStatus: setActiveWithdraw });
        setActiveWithdraw(rec);
        setLastTx(rec.bridgeTxHash ?? rec.feeTxHash ?? null);
        toast.success("Withdraw submitted — tracking status", { id: "vtx" });
      }
      setAmount("");
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      toast.error(msg.length > 80 ? msg.slice(0, 80) + "…" : msg, { id: "vtx" });
    } finally {
      setBusy(false);
    }
  };

  const feeUsd = mode === "deposit" ? DEPOSIT_FEE_USD : WITHDRAW_FEE_USD;
  const netAmount = Math.max(0, num - feeUsd);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="box-sm p-3 bg-[color:var(--yellow-accent)]">
          <div className="text-[10px] uppercase tracking-wider mb-1">Arbitrum USDC</div>
          <div className="font-display text-2xl">${parseFloat(arbUsdcBal).toFixed(2)}</div>
        </div>
        <div className="box-sm p-3">
          <div className="text-[10px] uppercase tracking-wider mb-1 text-muted-foreground">Celo cUSD</div>
          <div className="font-display text-2xl">${parseFloat(walletBal).toFixed(2)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-0 box-sm p-1">
        {(["deposit", "withdraw"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setAmount(""); }} className={`py-3 text-xs font-bold uppercase tracking-wider ${mode === m ? "bg-foreground text-background" : ""}`}>{m}</button>
        ))}
      </div>

      <div className="box-inset p-4">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.00"
          inputMode="decimal"
          className="w-full bg-transparent outline-none text-2xl font-mono"
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Available: {parseFloat(max).toFixed(4)} {mode === "deposit" ? "cUSD" : "USDC"}</span>
        <div className="flex gap-1">
          {[0.25, 0.5, 1].map(p => (
            <button key={p} onClick={() => setAmount((parseFloat(max) * p).toString())} className="box-sm px-2 py-1 text-[10px] font-bold">
              {p === 1 ? "MAX" : `${p * 100}%`}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!valid || busy}
        className={`box w-full font-display text-lg py-4 flex items-center justify-center gap-2 disabled:opacity-50 ${mode === "deposit" ? "bg-[color:var(--profit)] text-white" : "bg-[color:var(--yellow-accent)]"}`}
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === "deposit" ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
        {busy ? "PROCESSING…" : mode === "deposit" ? "BRIDGE TO ARBITRUM" : "WITHDRAW TO MINIPAY"}
      </button>

      {valid && (
        <div className="box-sm p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Protocol fee</span>
            <span className="font-mono">${feeUsd.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Net bridged</span>
            <span className="font-mono">{netAmount.toFixed(4)} {mode === "deposit" ? "cUSD" : "USDC"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">You receive</span>
            <span className="font-mono">
              {quoting ? "…"
                : mode === "deposit"
                  ? quote ? `${quote.toAmount} USDC` : "—"
                  : wQuote ? `${wQuote.toAmount} cUSD` : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Min received</span>
            <span className="font-mono">
              {mode === "deposit"
                ? quote ? `${quote.toAmountMin} USDC` : "—"
                : wQuote ? `${wQuote.toAmountMin} cUSD` : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">ETA</span>
            <span className="font-mono">
              {(() => {
                const d = mode === "deposit" ? quote?.estimatedRouteDuration : wQuote?.estimatedRouteDuration;
                return d ? `~${Math.max(1, Math.round(d / 60))} min` : "—";
              })()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Route</span>
            <span>{mode === "deposit" ? "Celo cUSD → Arbitrum USDC" : "Arbitrum USDC → Celo cUSD"}</span>
          </div>
        </div>
      )}

      {(activeDeposit || activeWithdraw) && (
        <div className="box-sm p-3 text-xs space-y-1 bg-[color:var(--cyan-accent)]/10">
          <div className="flex justify-between font-bold">
            <span>Status</span>
            <span>{activeDeposit?.status ?? activeWithdraw?.status}</span>
          </div>
          {(activeDeposit?.squidStatus ?? activeWithdraw?.squidStatus) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bridge</span>
              <span className="font-mono">{activeDeposit?.squidStatus ?? activeWithdraw?.squidStatus}</span>
            </div>
          )}
          {(activeDeposit?.error ?? activeWithdraw?.error) && (
            <div className="text-[color:var(--loss)]">{activeDeposit?.error ?? activeWithdraw?.error}</div>
          )}
        </div>
      )}

      {lastTx && (
        <a
          href={`https://axelarscan.io/gmp/${lastTx}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1 text-xs text-[color:var(--cyan-accent)] font-bold"
        >
          Track on Axelarscan <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {!SQUID_INTEGRATOR_ID && (
        <div className="border-t border-dashed pt-3 text-xs text-[color:var(--loss)] leading-relaxed">
          ⚠ Bridge not configured. Set <span className="font-mono">VITE_SQUID_INTEGRATOR_ID</span> (from app.squidrouter.com) in <span className="font-mono">.env</span>.
        </div>
      )}

      <div className="border-t border-dashed pt-3 text-xs text-muted-foreground leading-relaxed">
        Powered by Squid Router. Non-custodial: USDC sits in your own Arbitrum wallet — used as collateral for GMX v2 perps. Withdrawals bridge USDC back to cUSD into MiniPay. Protocol fees: $0.05 deposit, $0.10 withdrawal.
      </div>
    </div>
  );
}

function ProfileTab({ session }: { session: Session }) {
  return (
    <div className="space-y-4">
      <div className="box-sm p-4">
        <div className="text-[10px] uppercase tracking-wider mb-2 text-muted-foreground">Profile</div>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 box-sm grid place-items-center bg-[color:var(--magenta-accent)] text-white font-display text-xl">{session.username.slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="font-display text-lg">{session.username}</div>
            <div className="text-xs text-muted-foreground">@{session.username}</div>
            <div className="text-xs text-muted-foreground font-mono">{session.wallet.slice(0, 6)}…{session.wallet.slice(-4)}</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[["Total Trades", "23"], ["Win Rate", "61%"], ["Total Profit", "$124.22"], ["ROI", "+10.2%"], ["Volume", "$8,450"], ["Avg Trade", "$367"]].map(([l, v]) => (
          <div key={l} className="box-sm p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
            <div className="font-display text-xl">{v}</div>
          </div>
        ))}
      </div>
      <Streak />
      <div className="box-sm p-4">
        <div className="text-[10px] uppercase tracking-wider mb-2 text-muted-foreground">Referral</div>
        <div className="font-mono text-sm break-all">flash.xyz/ref/{session.username}</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-[10px] text-muted-foreground">Refs</div><div className="font-display">0</div></div>
          <div><div className="text-[10px] text-muted-foreground">Earnings</div><div className="font-display">$0</div></div>
          <div><div className="text-[10px] text-muted-foreground">Volume</div><div className="font-display">$0</div></div>
        </div>
      </div>
    </div>
  );
}

function Streak() {
  const days = Array.from({ length: 7 * 12 }, (_, i) => (i * 73) % 5);
  const shades = ["bg-white", "bg-[color:var(--cyan-accent)]/30", "bg-[color:var(--profit)]/40", "bg-[color:var(--profit)]/70", "bg-[color:var(--profit)]"];
  return (
    <div className="box-sm p-4 bg-[color:var(--yellow-accent)]">
      <div className="text-[10px] uppercase tracking-wider mb-3">Trading Streak</div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[["Current", "3"], ["Longest", "7"], ["Active", "12"]].map(([l, v]) => (
          <div key={l} className="box-sm p-2 bg-white text-center">
            <div className="text-[9px] uppercase text-muted-foreground">{l}</div>
            <div className="font-display text-lg">{v}</div>
          </div>
        ))}
      </div>
      <div className="box-sm p-2 bg-white">
        <div className="grid grid-cols-12 gap-[3px]">
          {days.map((d, i) => (
            <div key={i} className={`aspect-square border border-foreground/40 ${shades[d]}`} />
          ))}
        </div>
      </div>
      <div className="flex justify-between mt-2 text-[10px] uppercase text-muted-foreground">
        <span>23 trades</span>
        <div className="flex items-center gap-1">Less {shades.slice().map((s, i) => <span key={i} className={`w-3 h-3 border border-foreground/40 ${s}`} />)} More</div>
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="space-y-3">
      {["Notifications", "Display", "Security", "About"].map(l => (
        <div key={l} className="box-sm p-4 flex justify-between items-center">
          <span className="font-bold uppercase text-sm">{l}</span>
          <ChevronDown className="w-4 h-4 -rotate-90" />
        </div>
      ))}
    </div>
  );
}