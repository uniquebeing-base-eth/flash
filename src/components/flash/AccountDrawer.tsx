import { useEffect, useState, useCallback } from "react";
import { Drawer } from "./Drawer";
import { User, ChevronDown, TrendingUp, TrendingDown, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  FLASH_VAULT_ADDRESS,
  withdrawCusd,
  getVaultBalance,
  getWalletCusdBalance,
} from "@/lib/flashVault";
import {
  bridgeDeposit,
  quoteDeposit,
  SQUID_INTEGRATOR_ID,
  type BridgeQuote,
} from "@/lib/squidBridge";

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
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const refresh = useCallback(async () => {
    const [v, w] = await Promise.allSettled([
      getVaultBalance(session.wallet),
      getWalletCusdBalance(session.wallet),
    ]);
    if (v.status === "fulfilled") setVaultBal(v.value);
    if (w.status === "fulfilled") setWalletBal(w.value);
  }, [session.wallet]);

  useEffect(() => { refresh(); }, [refresh]);

  const max = mode === "deposit" ? walletBal : vaultBal;
  const num = parseFloat(amount || "0");
  const valid = num > 0 && num <= parseFloat(max || "0");

  // Debounced Squid quote on deposit amount changes
  useEffect(() => {
    if (mode !== "deposit" || !valid || !SQUID_INTEGRATOR_ID) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await quoteDeposit(amount);
        setQuote(q);
      } catch {
        setQuote(null);
      } finally {
        setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [amount, mode, valid]);

  const submit = async () => {
    if (!valid) return;
    if (mode === "deposit" && !SQUID_INTEGRATOR_ID) {
      toast.error("Bridge not configured. Set VITE_SQUID_INTEGRATOR_ID.");
      return;
    }
    if (mode === "withdraw" && !FLASH_VAULT_ADDRESS) {
      toast.error("Withdrawals require the treasury server (coming soon).");
      return;
    }
    setBusy(true);
    setLastTx(null);
    try {
      toast.loading(
        mode === "deposit" ? "Bridging cUSD → Arbitrum USDC…" : "Withdrawing cUSD…",
        { id: "vtx" }
      );
      const isMax = num === parseFloat(max);
      const hash =
        mode === "deposit"
          ? await bridgeDeposit(amount)
          : await withdrawCusd(isMax ? "max" : amount);
      setLastTx(hash);
      toast.success(
        mode === "deposit" ? "Bridge submitted — funds en route to Arbitrum" : "Withdrawn",
        { id: "vtx" }
      );
      setAmount("");
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      toast.error(msg.length > 80 ? msg.slice(0, 80) + "…" : msg, { id: "vtx" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="box-sm p-3 bg-[color:var(--yellow-accent)]">
          <div className="text-[10px] uppercase tracking-wider mb-1">Vault Balance</div>
          <div className="font-display text-2xl">${parseFloat(vaultBal).toFixed(2)}</div>
        </div>
        <div className="box-sm p-3">
          <div className="text-[10px] uppercase tracking-wider mb-1 text-muted-foreground">In Wallet</div>
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
        <span className="text-muted-foreground">{mode === "deposit" ? "Wallet" : "Vault"}: {parseFloat(max).toFixed(4)} cUSD</span>
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
        {busy ? "PROCESSING…" : mode === "deposit" ? "BRIDGE TO ARBITRUM" : "WITHDRAW cUSD"}
      </button>

      {mode === "deposit" && valid && (
        <div className="box-sm p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">You receive</span>
            <span className="font-mono">{quoting ? "…" : quote ? `${quote.toAmount} USDC` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Min received</span>
            <span className="font-mono">{quote ? `${quote.toAmountMin} USDC` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">ETA</span>
            <span className="font-mono">{quote ? `~${Math.max(1, Math.round(quote.estimatedRouteDuration / 60))} min` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Route</span>
            <span>Celo cUSD → Arbitrum USDC</span>
          </div>
        </div>
      )}

      {lastTx && (
        <a
          href={mode === "deposit" ? `https://axelarscan.io/gmp/${lastTx}` : `https://celoscan.io/tx/${lastTx}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1 text-xs text-[color:var(--cyan-accent)] font-bold"
        >
          {mode === "deposit" ? "Track on Axelarscan" : "View transaction"} <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {!SQUID_INTEGRATOR_ID && (
        <div className="border-t border-dashed pt-3 text-xs text-[color:var(--loss)] leading-relaxed">
          ⚠ Bridge not configured. Set <span className="font-mono">VITE_SQUID_INTEGRATOR_ID</span> (from app.squidrouter.com) in <span className="font-mono">.env</span>.
        </div>
      )}

      <div className="border-t border-dashed pt-3 text-xs text-muted-foreground leading-relaxed">
        Powered by Squid Router. Deposits bridge cUSD on Celo → USDC on Arbitrum into your own wallet — used as collateral for GMX v2 perps. Non-custodial, one signature, ~1–3 min settlement.
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