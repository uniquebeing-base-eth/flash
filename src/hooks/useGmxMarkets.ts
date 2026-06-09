import { useEffect, useState } from "react";
import { fetchGmxMarkets, type GmxMarketRow } from "@/lib/gmxMarkets.functions";

export interface UseGmxMarkets {
  markets: GmxMarketRow[];
  bySymbol: Record<string, GmxMarketRow>;
  byMarketAddress: Record<string, GmxMarketRow>;
  indexMetaByMarket: Record<string, { address: string; symbol: string; decimals: number }>;
  loading: boolean;
}

// Approximate index-token decimals on Arbitrum.
// 8 for BTC, 18 for everything else native/wrapped. Synthetics use 18.
const KNOWN_DECIMALS: Record<string, number> = {
  WBTC: 8, "BTC": 8, "TBTC": 18,
};

export function useGmxMarkets(): UseGmxMarkets {
  const [markets, setMarkets] = useState<GmxMarketRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    const load = () => fetchGmxMarkets()
      .then((r) => { if (!cancel) setMarkets(r.markets); })
      .catch(() => { /* keep prev */ })
      .finally(() => { if (!cancel) setLoading(false); });
    load();
    const id = setInterval(load, 30_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  const bySymbol: Record<string, GmxMarketRow> = {};
  const byMarketAddress: Record<string, GmxMarketRow> = {};
  const indexMetaByMarket: Record<string, { address: string; symbol: string; decimals: number }> = {};
  for (const m of markets) {
    bySymbol[m.symbol] = m;
    bySymbol[m.indexSymbol] = m;
    byMarketAddress[m.marketToken.toLowerCase()] = m;
    const decimals = KNOWN_DECIMALS[m.indexSymbol.toUpperCase()] ?? 18;
    indexMetaByMarket[m.marketToken.toLowerCase()] = {
      address: m.indexToken,
      symbol: m.indexSymbol,
      decimals,
    };
  }
  return { markets, bySymbol, byMarketAddress, indexMetaByMarket, loading };
}