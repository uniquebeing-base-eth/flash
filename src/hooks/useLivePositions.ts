import { useEffect, useState, useCallback } from "react";
import { fetchGmxPositions, fetchGmxTickers, type RawPosition, type RawOrder } from "@/lib/gmxPositions.functions";

export interface LivePosition {
  key: string;
  marketAddress: string;
  indexTokenAddress: string;
  indexSymbol: string;
  indexTokenDecimals: number;
  isLong: boolean;
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPct: number;
  liquidationPrice: number;
  leverage: number;
  triggerOrders: { type: "TP" | "SL"; triggerPrice: number; sizeDeltaUsd: number }[];
}

interface IndexMeta { address: string; symbol: string; decimals: number; }

/**
 * Reads GMX positions from subsquid + live tickers and derives PnL / liq.
 * Polls every 5s. Pass `indexMetaByMarket` to map market address → index token meta.
 */
export function useLivePositions(
  account: string | undefined,
  indexMetaByMarket: Record<string, IndexMeta>,
) {
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!account) { setPositions([]); return; }
    setLoading(true);
    try {
      const [posResp, tickResp] = await Promise.all([
        fetchGmxPositions({ data: { account } }),
        fetchGmxTickers(),
      ]);
      const tickerMap = new Map(
        tickResp.tickers.map(t => [t.tokenAddress.toLowerCase(), (Number(t.minPrice) + Number(t.maxPrice)) / 2])
      );

      const ordersByMarket = new Map<string, RawOrder[]>();
      for (const o of posResp.orders) {
        const key = `${o.marketAddress.toLowerCase()}-${o.isLong}`;
        if (!ordersByMarket.has(key)) ordersByMarket.set(key, []);
        ordersByMarket.get(key)!.push(o);
      }

      const out: LivePosition[] = [];
      for (const p of posResp.positions as RawPosition[]) {
        const meta = indexMetaByMarket[p.marketAddress.toLowerCase()];
        if (!meta) continue;
        const priceDecimals = 30 - meta.decimals;
        const rawPrice = tickerMap.get(meta.address.toLowerCase());
        if (!rawPrice) continue;
        const markPrice = rawPrice / Math.pow(10, priceDecimals);
        const entryPrice = Number(p.entryPrice) / Math.pow(10, priceDecimals);
        const sizeUsd = Number(p.sizeInUsd) / 1e30;
        // collateral is USDC (6 decimals), USD pegged
        const collateralUsd = Number(p.collateralAmount) / 1e6;
        const direction = p.isLong ? 1 : -1;
        const pnl = ((markPrice - entryPrice) / entryPrice) * sizeUsd * direction;
        const pnlPct = collateralUsd > 0 ? (pnl / collateralUsd) * 100 : 0;
        const leverage = collateralUsd > 0 ? sizeUsd / collateralUsd : 0;
        // approximate liq: entry ± entry * collateral / size (ignores fees/maintenance margin)
        const liquidationPrice = p.isLong
          ? entryPrice * (1 - collateralUsd / sizeUsd)
          : entryPrice * (1 + collateralUsd / sizeUsd);

        const orderKey = `${p.marketAddress.toLowerCase()}-${p.isLong}`;
        const triggers = (ordersByMarket.get(orderKey) ?? [])
          .filter(o => o.orderType === 5 || o.orderType === 6)
          .map(o => ({
            type: o.orderType === 5 ? "TP" as const : "SL" as const,
            triggerPrice: Number(o.triggerPrice) / Math.pow(10, priceDecimals),
            sizeDeltaUsd: Number(o.sizeDeltaUsd) / 1e30,
          }));

        out.push({
          key: p.id,
          marketAddress: p.marketAddress,
          indexTokenAddress: meta.address,
          indexSymbol: meta.symbol,
          indexTokenDecimals: meta.decimals,
          isLong: p.isLong,
          sizeUsd, collateralUsd, entryPrice, markPrice,
          pnl, pnlPct, liquidationPrice, leverage,
          triggerOrders: triggers,
        });
      }
      setPositions(out);
    } catch {
      // keep previous on transient error
    } finally {
      setLoading(false);
    }
  }, [account, indexMetaByMarket]);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5_000);
    return () => clearInterval(id);
  }, [reload]);

  return { positions, loading, reload };
}