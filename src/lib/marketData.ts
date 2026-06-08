import { useEffect, useRef, useState } from "react";
import {
  fetchYahooCandles,
  fetchYahooSnapshots,
  fetchBinanceCandles,
  fetchBinanceSnapshots,
} from "@/lib/marketCandles.functions";

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }
export interface MarketSnapshot { price: number; change24h: number; }

const TF_TO_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

/**
 * Live OHLC + last price — server-proxied so it works in every region.
 */
export function useLiveMarket(binanceSymbol: string | undefined, fallbackSeed: string, basePrice: number, timeframe: string) {
  return useLiveMarketV2({ binance: binanceSymbol, yahoo: undefined, fallbackSeed, basePrice, timeframe });
}

interface LiveMarketArgs {
  binance?: string;
  yahoo?: string;
  fallbackSeed: string;
  basePrice: number;
  timeframe: string;
}

export function useLiveMarketV2({ binance: binanceSymbol, yahoo: yahooSymbol, fallbackSeed, basePrice, timeframe }: LiveMarketArgs) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [price, setPrice] = useState<number>(basePrice);
  const [change24h, setChange24h] = useState<number | undefined>(undefined);
  const _tfMs = TF_TO_MS[timeframe] ?? 60_000;
  void _tfMs;
  void fallbackSeed;

  useEffect(() => {
    let cancelled = false;
    setCandles([]);
    setChange24h(undefined);

    const load = async () => {
      try {
        const result = binanceSymbol
          ? await fetchBinanceCandles({ data: { symbol: binanceSymbol, timeframe } })
          : yahooSymbol
            ? await fetchYahooCandles({ data: { symbol: yahooSymbol, timeframe } })
            : null;
        if (!result || cancelled) return;
        if (result.candles.length) {
          setCandles(result.candles);
          setPrice(result.price || result.candles[result.candles.length - 1].c);
        }
        if (Number.isFinite(result.change24h)) setChange24h(result.change24h);
      } catch { /* network blip — keep prior data */ }
    };

    if (!binanceSymbol && !yahooSymbol) return;
    load();
    const fast = setInterval(load, 5_000);
    return () => { cancelled = true; clearInterval(fast); };
  }, [binanceSymbol, yahooSymbol, timeframe, basePrice]);

  return { candles, price, change24h };
}

export function useMarketSnapshots(markets: { binance?: string; yahoo?: string; price: number; change24h: number }[]) {
  const [snapshots, setSnapshots] = useState<Record<number, MarketSnapshot>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next: Record<number, MarketSnapshot> = {};
      const binanceSymbols = markets.map(m => m.binance).filter((s): s is string => !!s);
      const yahooSymbols = markets.map(m => m.yahoo).filter((s): s is string => !!s);
      await Promise.all([
        (async () => {
          if (!binanceSymbols.length) return;
          try {
            const { snapshots } = await fetchBinanceSnapshots({ data: { symbols: binanceSymbols } });
            markets.forEach((m, idx) => { if (m.binance && snapshots[m.binance]) next[idx] = snapshots[m.binance]; });
          } catch { /* keep fallback */ }
        })(),
        (async () => {
          if (!yahooSymbols.length) return;
          try {
            const { snapshots } = await fetchYahooSnapshots({ data: { symbols: yahooSymbols } });
            markets.forEach((m, idx) => { if (m.yahoo && snapshots[m.yahoo]) next[idx] = snapshots[m.yahoo]; });
          } catch { /* keep fallback */ }
        })(),
      ]);
      if (!cancelled) setSnapshots(next);
    };
    load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [markets]);

  return snapshots;
}