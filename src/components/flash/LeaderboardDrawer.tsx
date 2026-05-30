import { useState } from "react";
import { Drawer } from "./Drawer";
import { Trophy, Share2 } from "lucide-react";

const ROWS = [
  { rank: 1, user: "@metasalary", profit: 12450.22, roi: 245.1, vol: 84320, color: "bg-[color:var(--yellow-accent)]" },
  { rank: 2, user: "@zoo", profit: 8932.4, roi: 188.4, vol: 62110, color: "bg-white" },
  { rank: 3, user: "@ky-colonel", profit: 6210.1, roi: 142.0, vol: 51200, color: "bg-orange-200" },
  { rank: 4, user: "@0xhohenheim", profit: 3450.5, roi: 98.2, vol: 32100 },
  { rank: 5, user: "@pare", profit: 2180.0, roi: 76.3, vol: 24500 },
  { rank: 6, user: "@shaan-feroz", profit: 1542.8, roi: 54.2, vol: 18200 },
  { rank: 7, user: "@flashuser", profit: 124.22, roi: 10.2, vol: 8450, me: true },
];

export function LeaderboardDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"biweekly" | "alltime">("biweekly");
  return (
    <Drawer open={open} onClose={onClose} title="LEADERBOARD" icon={<Trophy className="w-7 h-7" strokeWidth={2.5} />}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
        {tab === "biweekly" ? "MAY 27 — JUN 9 — Resets in 13d" : "ALL TIME RANKINGS"}
      </div>

      <div className="grid grid-cols-2 gap-0 box-sm mb-4 p-1">
        {(["biweekly", "alltime"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-2 text-xs font-bold tracking-wider uppercase ${tab === t ? "bg-foreground text-background" : ""}`}>{t === "biweekly" ? "Biweekly" : "All-Time"}</button>
        ))}
      </div>

      <div className="box p-3 bg-[color:var(--yellow-accent)] mb-4 flex items-center gap-3">
        <div className="w-12 h-12 box-sm bg-[color:var(--magenta-accent)] grid place-items-center text-white font-display">F</div>
        <div className="flex-1">
          <div className="font-display">flashuser</div>
          <div className="text-xs text-muted-foreground">@flashuser</div>
        </div>
        <div className="font-display text-2xl italic">#7</div>
        <button className="box-sm w-10 h-10 grid place-items-center bg-[color:var(--cyan-accent)]"><Share2 className="w-4 h-4" /></button>
      </div>

      <div className="box bg-foreground">
        <div className="grid grid-cols-[60px_1fr_auto] gap-2 px-3 py-2 text-background text-[10px] uppercase tracking-wider font-bold">
          <div>Rank</div><div>Trader</div><div>{tab === "biweekly" ? "Profit" : "Lifetime"}</div>
        </div>
      </div>

      <div className="space-y-2 mt-2">
        {ROWS.map(r => (
          <div key={r.rank} className={`box-sm p-2 grid grid-cols-[60px_1fr_auto] items-center gap-2 ${r.me ? "bg-[color:var(--yellow-accent)]" : "bg-white"}`}>
            <div className={`box-sm py-2 text-center font-display ${r.color || ""}`}>
              {r.rank <= 3 ? ["1st", "2nd", "3rd"][r.rank - 1] : `#${r.rank}`}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 box-sm bg-muted grid place-items-center font-display text-xs">{r.user[1].toUpperCase()}</div>
              <span className="font-bold text-sm">{r.user}</span>
            </div>
            <div className="text-right">
              <div className="font-display text-sm text-[color:var(--profit)]">+${r.profit.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">{r.roi}% • ${r.vol.toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="box mt-5 p-4 bg-white">
        <div className="font-display text-sm mb-2">⚡ REWARD POOL</div>
        <div className="text-xs text-muted-foreground mb-3">Top 10 share the biweekly pool. 1st: 25% • 2nd: 15% • 3rd: 10% • 4–10: 50%</div>
        <div className="font-display text-3xl">$5,420</div>
      </div>
    </Drawer>
  );
}