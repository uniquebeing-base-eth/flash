import { Drawer } from "./Drawer";
import { Trophy } from "lucide-react";

export function LeaderboardDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="LEADERBOARD" icon={<Trophy className="w-7 h-7" strokeWidth={2.5} />}>
      <div className="box p-6 bg-white text-center space-y-3">
        <div className="font-display text-xl">Coming Soon</div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The biweekly leaderboard ranks real GMX v2 traders on Flash. Reward pool and rankings will go live once enough trades are on-chain. Get a head start — make some real trades.
        </p>
      </div>
    </Drawer>
  );
}