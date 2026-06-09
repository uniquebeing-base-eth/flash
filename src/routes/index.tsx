import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { User, History, Trophy, ChevronDown, TrendingUp, TrendingDown, Eye, Info, Zap, Loader2 } from "lucide-react";
import { MARKETS, type Market } from "@/components/flash/markets";
import { Chart } from "@/components/flash/Chart";
import { AccountDrawer } from "@/components/flash/AccountDrawer";
import { HistoryDrawer } from "@/components/flash/HistoryDrawer";
import { LeaderboardDrawer } from "@/components/flash/LeaderboardDrawer";
import { UsernameGate } from "@/components/flash/UsernameGate";
import { useLiveMarketV2, useMarketSnapshots } from "@/lib/marketData";
import { useGmxMarkets } from "@/hooks/useGmxMarkets";
import { useLivePositions } from "@/hooks/useLivePositions";
import { openMarketPosition, closeMarketPosition } from "@/lib/gmxOrders";
import { getArbUsdcBalance } from "@/lib/withdrawBridge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flash — Perps Made Simple" },
      { name: "description", content: "Trade GMX v2 perpetuals directly from MiniPay. Deposit cUSD, trade crypto / forex / commodities, withdraw to cUSD." },
      { property: "og:title", content: "Flash — Perps Made Simple" },
      { property: "og:description", content: "MiniPay-native GMX v2 trading." },
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
  const [tpInput, setTpInput] = useState("");
  const [slInput, setSlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [balance, setBalance] = useState(0);

  // Real Arbitrum USDC balance — used as GMX collateral
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const b = await getArbUsdcBalance(session.wallet);
        if (!cancelled) setBalance(parseFloat(b));
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session.wallet, drawer, submitting, closing]);

  const gmx = useGmxMarkets();
  const { positions, reload: reloadPositions } = useLivePositions(session.wallet, gmx.indexMetaByMarket);

  const market = MARKETS[marketIdx];
  const indexSym = market.symbol.split("/")[0];
  const gmxMarket = gmx.bySymbol[indexSym] ?? gmx.bySymbol[market.symbol];
  const tradable = !!gmxMarket;

  const marketSnapshots = useMarketSnapshots(MARKETS);
  const { candles, price: livePrice, change24h: liveChange24h } = useLiveMarketV2({
    binance: market.binance,
    yahoo: market.yahoo,
    fallbackSeed: market.symbol,
    basePrice: market.price,
    timeframe,
  });
  const selectedChange24h = typeof liveChange24h === "number" && Number.isFinite(liveChange24h)
    ? liveChange24h
    : (marketSnapshots[marketIdx]?.change24h ?? gmxMarket?.change24h ?? 0);
  const displayPrice = livePrice || gmxMarket?.price || 0;

  const activePosition = useMemo(
    () => positions.find(p => gmxMarket && p.marketAddress.toLowerCase() === gmxMarket.marketToken.toLowerCase()),
    [positions, gmxMarket],
  );

  const collateralUsd = +(balance * (sizePct / 100) || 0).toFixed(2);
  const sizeUsd = +(collateralUsd * leverage).toFixed(2);
  const margin = collateralUsd;
  const liqL = +(displayPrice * (1 - 0.95 / leverage)).toFixed(2);
  const liqS = +(displayPrice * (1 + 0.95 / leverage)).toFixed(2);

  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalCol = positions.reduce((s, p) => s + p.collateralUsd, 0);
  const totalPct = totalCol > 0 ? (totalPnl / totalCol) * 100 : 0;
  const netWorth = balance + totalPnl;

  const submitOrder = async (isLong: boolean) => {
    if (!gmxMarket) { toast.error("This market is not tradable on GMX yet."); return; }
    if (collateralUsd <= 0) { toast.error("Set a position size first."); return; }
    if (collateralUsd > balance) { toast.error("Insufficient USDC on Arbitrum."); return; }
    const indexDecimals = gmx.indexMetaByMarket[gmxMarket.marketToken.toLowerCase()]?.decimals ?? 18;
    const tp = parseFloat(tpInput) || undefined;
    const sl = parseFloat(slInput) || undefined;
    setSubmitting(true);
    try {
      toast.loading("Submitting order to GMX…", { id: "ord" });
      await openMarketPosition({
        marketAddress: gmxMarket.marketToken,
        indexTokenDecimals: indexDecimals,
        collateralAmountUsdc: collateralUsd,
        sizeDeltaUsd: sizeUsd,
        isLong,
        markPrice: displayPrice,
        takeProfitPrice: tp,
        stopLossPrice: sl,
      });
      toast.success("Order submitted — keeper executing shortly", { id: "ord" });
      setTpInput(""); setSlInput("");
      setTimeout(() => { void reloadPositions(); }, 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Order failed";
      toast.error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg, { id: "ord" });
    } finally {
      setSubmitting(false);
    }
  };

  const closeActive = async () => {
    if (!activePosition) return;
    setClosing(true);
    try {
      toast.loading("Closing position on GMX…", { id: "cls" });
      await closeMarketPosition({
        marketAddress: activePosition.marketAddress,
        indexTokenDecimals: activePosition.indexTokenDecimals,
        sizeDeltaUsd: activePosition.sizeUsd,
        collateralDeltaUsdc: activePosition.collateralUsd,
        isLong: activePosition.isLong,
        markPrice: activePosition.markPrice,
      });
      toast.success("Close submitted", { id: "cls" });
      setTimeout(() => { void reloadPositions(); }, 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Close failed";
      toast.error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg, { id: "cls" });
    } finally {
      setClosing(false);
    }
  };

  const tfs = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
  const fmtP = (p: number) => p ? p.toLocaleString(undefined, { maximumFractionDigits: p >= 10 ? 2 : 5 }) : "—";

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-md mx-auto px-3 pt-4 space-y-3">
        {/* TOP BAR */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              Net Worth: <span className="font-bold text-foreground">${netWorth.toFixed(2)}</span> <Eye className="w-3 h-3" />
            </div>
            <div className={`font-display text-5xl ${positions.length ? (totalPnl >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]") : "text-muted-foreground"}`}>
              {positions.length ? (totalPnl >= 0 ? "+" : "-") : ""}${Math.abs(positions.length ? totalPnl : 0).toFixed(2)}
            </div>
            {positions.length > 0 && (
              <div className={`text-sm font-bold ${totalPnl >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                {totalPnl >= 0 ? "+" : ""}{totalPct.toFixed(2)}%
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
              <span className="font-bold text-sm">${fmtP(displayPrice)}</span>
              <span className={`text-xs font-bold ${selectedChange24h >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                {selectedChange24h >= 0 ? "+" : ""}{selectedChange24h.toFixed(2)}%
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 transition ${marketOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="text-xs text-muted-foreground">{gmx.markets.length} mkts</div>
        </div>

        {marketOpen && (
          <div className="box-sm bg-white max-h-72 overflow-y-auto">
            {(["Crypto", "Forex", "Commodities"] as const).map(cat => (
              <div key={cat}>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted border-b border-foreground">{cat}</div>
                {MARKETS.filter(m => m.category === cat).map((m: Market) => {
                  const idx = MARKETS.indexOf(m);
                  const snapshot = marketSnapshots[idx];
                  const sym = m.symbol.split("/")[0];
                  const gm = gmx.bySymbol[sym];
                  const rowPrice = snapshot?.price ?? gm?.price ?? 0;
                  const rowChange = snapshot?.change24h ?? gm?.change24h ?? 0;
                  return (
                    <button key={m.symbol} onClick={() => { setMarketIdx(idx); setMarketOpen(false); }} className={`w-full px-3 py-2 flex items-center justify-between border-b border-foreground/10 ${idx === marketIdx ? "bg-[color:var(--yellow-accent)]" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-foreground text-background grid place-items-center text-[10px] font-bold">{m.icon}</span>
                        <span className="font-bold text-sm">{m.symbol}</span>
                        {gm && <span className="text-[9px] px-1 bg-[color:var(--profit)] text-white font-bold">GMX</span>}
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono">${rowPrice ? rowPrice.toLocaleString(undefined, { maximumFractionDigits: rowPrice >= 10 ? 2 : 5 }) : "—"}</div>
                        <div className={`text-[10px] ${rowChange >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>{rowChange >= 0 ? "+" : ""}{rowChange.toFixed(2)}%</div>
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
          price={displayPrice}
          entryPrice={activePosition?.entryPrice}
          liqPrice={activePosition?.liquidationPrice}
          isLive={!!(market.binance || market.yahoo)}
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
        </div>

        {/* ACTIVE POSITION */}
        {activePosition && (
          <>
            <div className="box p-4 bg-[color:var(--yellow-accent)] space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="box-sm px-2 py-1 text-xs font-bold bg-foreground text-background">{activePosition.indexSymbol}</span>
                <span className={`box-sm px-2 py-1 text-xs font-display ${activePosition.isLong ? "bg-[color:var(--profit)]" : "bg-[color:var(--loss)]"} text-white`}>{activePosition.isLong ? "LONG" : "SHORT"}</span>
                <span className="box-sm px-2 py-1 text-xs font-bold bg-foreground text-[color:var(--cyan-accent)]">{activePosition.leverage.toFixed(1)}x</span>
                <span className="box-sm px-2 py-1 text-xs font-bold bg-white">GMX v2</span>
              </div>
              <div className="border-t-2 border-foreground" />
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span>Entry:</span><span className="text-right font-mono">${fmtP(activePosition.entryPrice)}</span>
                <span>Mark:</span><span className="text-right font-mono">${fmtP(activePosition.markPrice)}</span>
                <span>Est. Liq:</span><span className="text-right font-mono">${activePosition.liquidationPrice.toFixed(2)}</span>
                <span>Collateral:</span><span className="text-right font-mono">${activePosition.collateralUsd.toFixed(2)}</span>
                <span>Size:</span><span className="text-right font-mono">${activePosition.sizeUsd.toFixed(2)}</span>
                {activePosition.triggerOrders.map((t, i) => (
                  <span key={i} className="contents">
                    <span>{t.type}:</span><span className="text-right font-mono">${t.triggerPrice.toFixed(2)}</span>
                  </span>
                ))}
              </div>
              <div className="border-t-2 border-dashed border-foreground" />
              <div className="flex items-center justify-between">
                <span className="text-sm">Unrealized PnL:</span>
                <span className={`font-display text-2xl ${activePosition.pnl >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]"}`}>
                  {activePosition.pnl >= 0 ? "+" : ""}${activePosition.pnl.toFixed(2)} <span className="text-xs">({activePosition.pnl >= 0 ? "+" : ""}{activePosition.pnlPct.toFixed(2)}%)</span>
                </span>
              </div>
            </div>
            <button onClick={closeActive} disabled={closing} className="box w-full py-5 font-display text-xl bg-[color:var(--yellow-accent)] flex items-center justify-center gap-2 disabled:opacity-50">
              {closing ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {closing ? "CLOSING…" : "CLOSE POSITION"}
            </button>
          </>
        )}

        {/* TRADE PANEL */}
        {!activePosition && (
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
                  <span className="font-display text-sm flex items-center gap-1">COLLATERAL <Info className="w-3 h-3" /></span>
                  <div className="flex items-center gap-1">
                    <span className="bg-foreground text-background text-xs font-bold px-2 py-1">{sizePct}%</span>
                    <span className="box-sm px-2 py-1 text-xs font-bold">${collateralUsd}</span>
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
                <span className="text-muted-foreground">Position size:</span><span className="text-right font-mono">${sizeUsd.toFixed(2)}</span>
                <span className="text-muted-foreground">Keeper fee:</span><span className="text-right font-mono">~0.0015 ETH</span>
                <span className="text-muted-foreground">Est. Liq (L):</span><span className="text-right font-mono">${liqL.toFixed(2)}</span>
                <span className="text-muted-foreground">Est. Liq (S):</span><span className="text-right font-mono">${liqS.toFixed(2)}</span>
                <span className="text-muted-foreground">USDC bal:</span><span className="text-right font-mono">${balance.toFixed(2)}</span>
                <span className="text-muted-foreground">GMX market:</span><span className="text-right font-mono">{tradable ? "✓" : "—"}</span>
              </div>
              <div className="border-t border-dashed" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold flex items-center gap-1">TP / SL <Info className="w-3 h-3" /></span>
                  <span className="text-[10px] text-muted-foreground">optional · USD trigger</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={tpInput} onChange={(e) => setTpInput(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Take profit $" inputMode="decimal" className="box-inset px-2 py-2 text-xs font-mono bg-white outline-none" />
                  <input value={slInput} onChange={(e) => setSlInput(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Stop loss $" inputMode="decimal" className="box-inset px-2 py-2 text-xs font-mono bg-white outline-none" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => submitOrder(true)} disabled={!tradable || submitting} className="box py-5 font-display text-xl bg-[color:var(--profit)] text-white flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <TrendingUp className="w-5 h-5" />} LONG
              </button>
              <button onClick={() => submitOrder(false)} disabled={!tradable || submitting} className="box py-5 font-display text-xl bg-[color:var(--loss)] text-white flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <TrendingDown className="w-5 h-5" />} SHORT
              </button>
            </div>
            {!tradable && (
              <div className="text-xs text-center text-muted-foreground">
                {gmx.loading ? "Loading GMX markets…" : `${market.symbol} is not on GMX v2 — pick a market with the GMX badge.`}
              </div>
            )}
          </>
        )}

        {/* SPLASH BRAND */}
        <div className="pt-6 pb-2 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground flex items-center justify-center gap-1">
          <Zap className="w-3 h-3" /> @{session.username} · Flash · GMX v2 + Squid
        </div>
      </div>

      <AccountDrawer open={drawer === "account"} onClose={() => setDrawer(null)} session={session} />
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
