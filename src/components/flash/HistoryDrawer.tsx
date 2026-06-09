import { useState } from "react";
import { Drawer } from "./Drawer";
import { History, ExternalLink } from "lucide-react";

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"open" | "closed" | "deposits" | "withdrawals">("open");
  return (
    <Drawer open={open} onClose={onClose} title="TRADE LOG" icon={<History className="w-7 h-7" strokeWidth={2.5} />}>
      <div className="grid grid-cols-4 gap-0 box-sm mb-4 p-1">
        {(["open", "closed", "deposits", "withdrawals"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`py-2 text-[10px] font-bold tracking-wider uppercase ${tab === t ? "bg-foreground text-background" : ""}`}>{t}</button>
        ))}
      </div>

      <div className="box p-6 bg-white text-center space-y-3">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">No {tab} yet</div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your real GMX v2 trade history will appear here. View open positions on the home screen, and track on-chain activity via GMX directly.
        </p>
        <a href="https://app.gmx.io/#/trade" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[color:var(--cyan-accent)] font-bold text-xs">
          Open GMX <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </Drawer>
  );
}