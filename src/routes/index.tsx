import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { User, History, Trophy, ChevronDown, TrendingUp, TrendingDown, Shuffle, Eye, Info, Zap } from "lucide-react";
import { MARKETS, type Market } from "@/components/flash/markets";
import { Chart } from "@/components/flash/Chart";
import { AccountDrawer } from "@/components/flash/AccountDrawer";
import { HistoryDrawer } from "@/components/flash/HistoryDrawer";
import { LeaderboardDrawer } from "@/components/flash/LeaderboardDrawer";
import { UsernameGate } from "@/components/flash/UsernameGate";
import { useLiveMarket } from "@/lib/marketData";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flash — Perps Made Simple" },
      { name: "description", content: "Trade crypto, forex & commodities perpetuals directly from MiniPay. Deposit cUSD, trade global markets, withdraw seamlessly." },
      { property: "og:title", content: "Flash — Perps Made Simple" },
      { property: "og:description", content: "MiniPay-native perpetual trading. Crypto, forex, commodities." },
    ],
  }),
  component: Page,
});

function Page() {
  return <UsernameGate>{(session) => <Index session={session} />}</UsernameGate>;
}

function Index({ session }: { session: { wallet: string; username: string } }) {
  const [marketIdx, setMarketIdx] = useState(1); // ETH default
  const [marketOpen, setMarketOpen] = useState(false);
  const [timeframe, setTimeframe] = useState("1h");
  const [leverage, setLeverage] = useState(20);
  const [sizePct, setSizePct] = useState(0);
  const [drawer, setDrawer] = useState<null | "account" | "history" | "lb">(null);
  const [position, setPosition] = useState<null | { dir: "LONG" | "SHORT"; entry: number; size: number; lev: number; margin: number; sym: string }>(null);

  const market = MARKETS[marketIdx];
  const balance = 1.64;

  const { candles, price: livePrice } = useLiveMarket(market.binance, market.symbol, market.price, timeframe);

  const sizeUsd = +(balance * (sizePct / 100) * leverage || 1).toFixed(2);
  const margin = +(sizeUsd / leverage).toFixed(2);
  const liqL = +(livePrice * (1 - 0.95 / leverage)).toFixed(2);
  const liqS = +(livePrice * (1 + 0.95 / leverage)).toFixed(2);

  const pnl = position ? (position.dir === "LONG" ? (livePrice - position.entry) : (position.entry - livePrice)) * (position.size / position.entry) : 0;
  const pnlPct = position ? (pnl / position.margin) * 100 : 0;
  const netWorth = balance + (position ? pnl : 0);

  const open = (dir: "LONG" | "SHORT") => {
    setPosition({ dir, entry: livePrice, size: sizeUsd, lev: leverage, margin, sym: market.symbol.split("/")[0] });
  };

  const tfs = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-md mx-auto px-3 pt-4 space-y-3">
        {/* TOP BAR */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              Net Worth: <span className="font-bold text-foreground">${netWorth.toFixed(2)}</span> <Eye className="w-3 h-3" />
            </div>
            <div className={`font-display text-5xl ${position && pnl !== 0 ? (pnl > 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]") : "text-muted-foreground"}`}>
              {position ? (pnl >= 0 ? "+" : "-") : ""}${Math.abs(position ? pnl : 0).toFixed(2)}
            </div>
            {position && (
              <div className={`text-sm font-bold ${pnl >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <IconBtn onClick={() => setDrawer("account")} active={drawer === "account"}><User className="w-5 h-5" strokeWidth={2.5} /></IconBtn>
            <IconBtn onClick={() => setDrawer("history")} active={drawer === "history"}><History className="w-5 h-5" strokeWidth={2.5} /></IconBtn>
            <IconBtn onClick={() => setDrawer("lb")} active={drawer === "lb"}><Trophy className="w-5 h-5" strokeWidth={2.5} /></IconBtn>
          </div>
        </div>

        {/* MARKET SELECTOR */}
        <div className="flex items-center gap-3">
          <button onClick={() => setMarketOpen(o => !o)} className="box-sm flex-1 px-3 py-3 flex items-center justify-between bg-white">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-foreground text-background grid place-items-center text-xs font-bold">{market.icon}</span>
              <span className="font-bold text-sm">${livePrice.toLocaleString()}</span>
              <span className={`text-xs font-bold ${market.change24h >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                {market.change24h >= 0 ? "+" : ""}{market.change24h}%
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 transition ${marketOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="text-xs text-muted-foreground">No favorites</div>
        </div>

        {marketOpen && (
          <div className="box-sm bg-white max-h-72 overflow-y-auto">
            {(["Crypto", "Forex", "Commodities"] as const).map(cat => (
              <div key={cat}>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted border-b border-foreground">{cat}</div>
                {MARKETS.filter(m => m.category === cat).map((m: Market, _i) => {
                  const idx = MARKETS.indexOf(m);
                  return (
                    <button key={m.symbol} onClick={() => { setMarketIdx(idx); setMarketOpen(false); }} className={`w-full px-3 py-2 flex items-center justify-between border-b border-foreground/10 ${idx === marketIdx ? "bg-[color:var(--yellow-accent)]" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-foreground text-background grid place-items-center text-[10px] font-bold">{m.icon}</span>
                        <span className="font-bold text-sm">{m.symbol}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono">${m.price.toLocaleString()}</div>
                        <div className={`text-[10px] ${m.change24h >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>{m.change24h >= 0 ? "+" : ""}{m.change24h}%</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* CHART */}
        <Chart
          candles={candles}
          price={livePrice}
          entryPrice={position?.entry}
          liqPrice={position ? (position.dir === "LONG" ? liqL : liqS) : undefined}
          isLive={!!market.binance}
        />

        {/* TIMEFRAMES */}
        <div className="flex gap-1.5">
          {tfs.slice(0, 5).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} className={`box-sm flex-1 py-2 text-xs font-bold ${timeframe === tf ? "bg-foreground text-background" : "bg-white"}`}>{tf}</button>
          ))}
          <div className="box-sm bg-white relative">
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="appearance-none bg-transparent pl-2 pr-6 py-2 text-xs font-bold outline-none">
              {tfs.map(tf => <option key={tf}>{tf}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button className="box-sm px-2 py-2 text-xs font-bold bg-white">DRAW</button>
          <button className="box-sm px-2 py-2 text-xs font-bold bg-white">RESET</button>
        </div>

        {/* ACTIVE POSITION */}
        {position && (
          <>
            <div className="box p-4 bg-[color:var(--yellow-accent)] space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="box-sm px-2 py-1 text-xs font-bold bg-foreground text-background">{position.sym}</span>
                <span className={`box-sm px-2 py-1 text-xs font-display ${position.dir === "LONG" ? "bg-[color:var(--profit)]" : "bg-[color:var(--loss)]"} text-white`}>{position.dir}</span>
                <span className="box-sm px-2 py-1 text-xs font-bold bg-foreground text-[color:var(--cyan-accent)]">{position.lev}x</span>
                <span className="box-sm px-2 py-1 text-xs font-bold bg-white">ISOLATED</span>
              </div>
              <div className="border-t-2 border-foreground" />
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span>Entry Price:</span><span className="text-right font-mono">${position.entry.toFixed(2)}</span>
                <span>Margin Used:</span><span className="text-right font-mono">${position.margin}</span>
                <span>Size:</span><span className="text-right font-mono">${position.size}</span>
              </div>
              <div className="border-t-2 border-dashed border-foreground" />
              <div className="flex items-center justify-between">
                <span className="text-sm">Unrealized PnL:</span>
                <span className={`font-display text-2xl ${pnl >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                  {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} <span className="text-xs">({pnl >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
                </span>
              </div>
            </div>
            <button onClick={() => setPosition(null)} className="box w-full py-5 font-display text-xl bg-[color:var(--yellow-accent)]">
              CLOSE POSITION
            </button>
          </>
        )}

        {/* TRADE PANEL */}
        {!position && (
          <>
            <div className="box p-4 bg-white space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display text-sm flex items-center gap-1">LEVERAGE <Info className="w-3 h-3" /></span>
                  <span className="box-sm px-2 py-1 text-xs font-display bg-foreground text-background">{leverage}x</span>
                </div>
                <SliderTrack value={leverage} min={1} max={50} onChange={setLeverage} color="var(--magenta-accent)" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display text-sm flex items-center gap-1">SIZE <Info className="w-3 h-3" /></span>
                  <div className="flex items-center gap-1">
                    <span className="bg-foreground text-background text-xs font-bold px-2 py-1">{sizePct}%</span>
                    <span className="box-sm px-2 py-1 text-xs font-bold">${sizeUsd}</span>
                  </div>
                </div>
                <SliderTrack value={sizePct} min={0} max={100} onChange={setSizePct} color="var(--cyan-accent)" />
              </div>

              <div className="flex gap-1.5">
                {[10, 25, 50, 100].map(p => (
                  <button key={p} onClick={() => setSizePct(p)} className="box-sm flex-1 py-1.5 text-xs font-bold bg-white">{p}%</button>
                ))}
                <button onClick={() => setSizePct(100)} className="box-sm px-3 py-1.5 text-xs font-bold bg-foreground text-background">MAX</button>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground underline">Margin:</span><span className="text-right font-mono">${margin}</span>
                <span className="text-muted-foreground underline">Opening Fees:</span><span className="text-right font-mono">&lt;$0.01</span>
                <span className="text-muted-foreground">LIQ (L):</span><span className="text-right font-mono">${liqL.toFixed(2)}</span>
                <span className="text-muted-foreground">LIQ (S):</span><span className="text-right font-mono">${liqS.toFixed(2)}</span>
              </div>
              <div className="border-t border-dashed" />
              <div className="flex items-center gap-2">
                <div className="box-sm w-12 h-6 relative bg-muted">
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white border-2 border-foreground" />
                </div>
                <span className="text-xs font-bold">TP / SL PROTECT (ROE)</span>
                <Info className="w-3 h-3" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => open("LONG")} className="box py-5 font-display text-xl bg-[color:var(--profit)] text-white flex items-center justify-center gap-2">
                <TrendingUp className="w-5 h-5" /> LONG
              </button>
              <button onClick={() => open("SHORT")} className="box py-5 font-display text-xl bg-[color:var(--loss)] text-white flex items-center justify-center gap-2">
                <TrendingDown className="w-5 h-5" /> SHORT
              </button>
            </div>
            <button onClick={() => open(Math.random() > 0.5 ? "LONG" : "SHORT")} className="box w-full py-5 font-display text-xl bg-[color:var(--magenta-accent)] text-foreground flex items-center justify-center gap-2">
              <Shuffle className="w-5 h-5" /> I'M FEELING LUCKY
            </button>
          </>
        )}

        {/* SPLASH BRAND */}
        <div className="pt-6 pb-2 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground flex items-center justify-center gap-1">
          <Zap className="w-3 h-3" /> @{session.username} · Flash · MiniPay Native
        </div>
      </div>

      <AccountDrawer open={drawer === "account"} onClose={() => setDrawer(null)} />
      <HistoryDrawer open={drawer === "history"} onClose={() => setDrawer(null)} />
      <LeaderboardDrawer open={drawer === "lb"} onClose={() => setDrawer(null)} />
    </div>
  );
}

function IconBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`box-sm w-12 h-12 grid place-items-center ${active ? "bg-foreground text-background" : "bg-white"}`}>
      {children}
    </button>
  );
}

function SliderTrack({ value, min, max, onChange, color }: { value: number; min: number; max: number; onChange: (v: number) => void; color: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="box-inset relative h-7 bg-muted">
      <div className="absolute left-0 top-0 h-full" style={{ width: `${pct}%`, background: `color-mix(in oklab, ${color} 20%, transparent)` }} />
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <div className="absolute top-1/2 -translate-y-1/2 w-6 h-6 border-2 border-foreground pointer-events-none" style={{ left: `calc(${pct}% - 12px)`, background: color }} />
    </div>
  );
}
