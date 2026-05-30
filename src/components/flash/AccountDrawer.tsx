import { useState } from "react";
import { Drawer } from "./Drawer";
import { User, ChevronDown, TrendingUp, Clock } from "lucide-react";

export function AccountDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "wallet" | "settings">("wallet");
  return (
    <Drawer open={open} onClose={onClose} title="ACCOUNT" icon={<User className="w-7 h-7" strokeWidth={2.5} />}>
      <div className="grid grid-cols-3 gap-0 box-sm mb-4 p-1">
        {(["profile", "wallet", "settings"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-3 text-xs font-bold tracking-wider uppercase ${tab === t ? "bg-foreground text-background" : "bg-card"}`}>{t}</button>
        ))}
      </div>

      {tab === "wallet" && <WalletTab />}
      {tab === "profile" && <ProfileTab />}
      {tab === "settings" && <SettingsTab />}
    </Drawer>
  );
}

function WalletTab() {
  const [chain, setChain] = useState("CELO");
  const [asset, setAsset] = useState("cUSD");
  const [amount, setAmount] = useState("");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="box-sm p-3 bg-[color:var(--yellow-accent)]">
          <div className="text-[10px] uppercase tracking-wider mb-1">Net Worth</div>
          <div className="font-display text-2xl">$1.64</div>
        </div>
        <div className="box-sm p-3">
          <div className="text-[10px] uppercase tracking-wider mb-1 text-muted-foreground">Available</div>
          <div className="font-display text-2xl">$1.64</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button className="box-sm py-4 font-display text-lg bg-[color:var(--profit)] text-white">DEPOSIT</button>
        <button className="box-sm py-4 font-display text-lg">WITHDRAW</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select value={chain} onChange={setChain} options={["CELO", "ARB", "ETH"]} />
        <Select value={asset} onChange={setAsset} options={["cUSD", "cEUR", "CELO"]} />
      </div>

      <div className="box-inset p-4">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full bg-transparent outline-none text-2xl font-mono" />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Balance: 1.64 cUSD</span>
        <div className="flex gap-1">
          {["25%", "50%", "MAX"].map(p => (
            <button key={p} className="box-sm px-2 py-1 text-[10px] font-bold">{p}</button>
          ))}
        </div>
      </div>

      <div className="text-xs text-[color:var(--cyan-accent)] font-bold">Min $1.50 recommended (bridge fees apply)</div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button className="box font-display text-lg py-4 bg-[color:var(--profit)] text-white flex items-center justify-center gap-2">
          <TrendingUp className="w-5 h-5" /> DEPOSIT
        </button>
        <button className="box-sm w-14 grid place-items-center bg-white">
          <Clock className="w-5 h-5" />
        </button>
      </div>

      <div className="text-center text-xs text-muted-foreground">
        Powered by <span className="font-bold text-foreground">⚡ Flash Bridge</span>
      </div>

      <div className="border-t border-dashed pt-3 text-xs text-muted-foreground leading-relaxed">
        * Deposits from cUSD/cEUR/CELO on Celo are auto-bridged to Arbitrum USDC and credited to your trading balance.
      </div>
    </div>
  );
}

function ProfileTab() {
  return (
    <div className="space-y-4">
      <div className="box-sm p-4">
        <div className="text-[10px] uppercase tracking-wider mb-2 text-muted-foreground">Profile</div>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 box-sm grid place-items-center bg-[color:var(--magenta-accent)] text-white font-display text-xl">F</div>
          <div>
            <div className="font-display text-lg">Trader</div>
            <div className="text-xs text-muted-foreground">@flashuser</div>
            <div className="text-xs text-muted-foreground">0x0000…0000</div>
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
        <div className="font-mono text-sm break-all">flash.xyz/ref/flashuser</div>
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

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="box-sm relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none bg-transparent px-4 py-3 font-bold text-sm pr-8 outline-none">
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
    </div>
  );
}