import { useState } from "react";
import { Drawer } from "./Drawer";
import { History, ExternalLink } from "lucide-react";

const TRADES = [
  { sym: "ETH", dir: "SHORT", lev: 20, entry: 2061.91, exit: 2063.11, pnl: -0.01, pct: -5.47, time: "27 May 17:22" },
  { sym: "XAU", dir: "LONG", lev: 20, entry: 4446.98, exit: 4448.1, pnl: 0.01, pct: 0.5, time: "27 May 17:56" },
  { sym: "XAU", dir: "SHORT", lev: 20, entry: 4445.9, exit: 4449.19, pnl: -0.02, pct: -1.48, time: "27 May 18:29" },
];

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"open" | "closed" | "deposits" | "withdrawals">("closed");
  return (
    <Drawer open={open} onClose={onClose} title="TRADE LOG" icon={<History className="w-7 h-7" strokeWidth={2.5} />}>
      <div className="grid grid-cols-4 gap-0 box-sm mb-4 p-1">
        {(["open", "closed", "deposits", "withdrawals"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-2 text-[10px] font-bold tracking-wider uppercase ${tab === t ? "bg-foreground text-background" : ""}`}>{t}</button>
        ))}
      </div>

      <div className="box p-4 bg-white space-y-5">
        {tab === "closed" && TRADES.map((t, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="box-sm px-2 py-0.5 text-[10px] font-bold">{t.sym}</span>
                <span className={`font-display text-lg ${t.dir === "LONG" ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>{t.dir}</span>
              </div>
              <div className="text-xs text-muted-foreground">{t.time}</div>
            </div>
            <div className="flex justify-between text-xs mb-2">
              <span>Entry: {t.entry.toLocaleString()}</span>
              <span>Exit: {t.exit.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="bg-foreground text-background text-[10px] font-bold px-2 py-1">{t.lev}x</span>
                <span className={`font-display text-2xl ${t.pnl >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} <span className="text-xs">({t.pct >= 0 ? "+" : ""}{t.pct}%)</span>
                </span>
              </div>
              <button className="box-sm w-9 h-9 grid place-items-center bg-[color:var(--cyan-accent)]"><ExternalLink className="w-4 h-4" /></button>
            </div>
            {i < TRADES.length - 1 && <div className="border-t-2 border-foreground mt-5" />}
          </div>
        ))}
        {tab !== "closed" && <div className="text-center text-sm text-muted-foreground py-12">No {tab} yet</div>}
      </div>
    </Drawer>
  );
}