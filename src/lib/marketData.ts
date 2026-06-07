import { useEffect, useRef, useState } from "react";
import { fetchYahooCandles, fetchYahooSnapshots } from "@/lib/marketCandles.functions";

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }
export interface MarketSnapshot { price: number; change24h: number; }

const TF_TO_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

function seededCandles(seed: number, basePrice: number, tfMs: number, count: number): Candle[] {
  let s = seed || 1;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const now = Date.now();
  const start = Math.floor(now / tfMs) * tfMs - (count - 1) * tfMs;
  const out: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const o = price;
    const change = (rand() - 0.5) * basePrice * 0.012;
    const c = +(o + change).toFixed(8);
    const h = +Math.max(o, c, o + rand() * basePrice * 0.006).toFixed(8);
    const l = +Math.min(o, c, o - rand() * basePrice * 0.006).toFixed(8);
    out.push({ t: start + i * tfMs, o, h, l, c, v: rand() * 100 });
    price = c;
  }
  return out;
}

/**
 * Live OHLC + last price.
 * - For Binance-mapped markets: REST seed + WebSocket kline stream (real data).
 * - For Forex / Commodities: Yahoo OHLC + live last-price polling.
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
  const wsRef = useRef<WebSocket | null>(null);
  const tfMs = TF_TO_MS[timeframe] ?? 60_000;

  useEffect(() => {
    let cancelled = false;
    setCandles([]);

    if (binanceSymbol) {
      const updateTicker = async () => {
        try {
          const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`);
          const row = await r.json();
          if (cancelled) return;
          const last = Number(row.lastPrice);
          const change = Number(row.priceChangePercent);
          if (Number.isFinite(last)) setPrice(last);
          if (Number.isFinite(change)) setChange24h(change);
        } catch { /* keep kline price */ }
      };
      updateTicker();
      const tickerId = setInterval(updateTicker, 5000);

      // 1) seed with real REST klines
      fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${timeframe}&limit=60`)
        .then(r => r.json())
        .then((rows: unknown) => {
          if (cancelled || !Array.isArray(rows)) return;
          const seeded: Candle[] = (rows as unknown[][]).map(row => ({
            t: Number(row[0]),
            o: parseFloat(String(row[1])),
            h: parseFloat(String(row[2])),
            l: parseFloat(String(row[3])),
            c: parseFloat(String(row[4])),
            v: parseFloat(String(row[5])),
          }));
          setCandles(seeded);
          if (seeded.length) setPrice(seeded[seeded.length - 1].c);
        })
        .catch(() => {
          // network blocked — fall back to simulation
          const seed = fallbackSeed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          setCandles(seededCandles(seed, basePrice, tfMs, 60));
        });

      // 2) live kline stream
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceSymbol.toLowerCase()}@kline_${timeframe}`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const k = msg.k;
          if (!k) return;
          const candle: Candle = {
            t: Number(k.t),
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
            v: parseFloat(k.v),
          };
          setPrice(candle.c);
          setCandles(prev => {
            if (!prev.length) return [candle];
            const last = prev[prev.length - 1];
            if (last.t === candle.t) {
              const next = prev.slice(0, -1);
              next.push(candle);
              return next;
            }
            const next = [...prev, candle];
            return next.slice(-60);
          });
        } catch { /* ignore */ }
      };
      return () => { cancelled = true; clearInterval(tickerId); ws.close(); };
    }

    // Yahoo Finance path (Forex / Commodities) — poll real OHLC every 20s.
    if (yahooSymbol) {
      const load = async () => {
        try {
          const { candles: rows, price: lastPrice, change24h: dayChange } = await fetchYahooCandles({ data: { symbol: yahooSymbol, timeframe } });
          if (cancelled || !rows.length) return;
          setCandles(rows);
          setPrice(lastPrice || rows[rows.length - 1].c);
          setChange24h(dayChange);
        } catch {
          // fall through to simulation below on first failure only
          if (cancelled) return;
          const seed = fallbackSeed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          const sim = seededCandles(seed, basePrice, tfMs, 60);
          setCandles(sim);
          setPrice(sim[sim.length - 1].c);
        }
      };
      const updateSnapshot = async () => {
        try {
          const { snapshots } = await fetchYahooSnapshots({ data: { symbols: [yahooSymbol] } });
          const snapshot = snapshots[yahooSymbol];
          if (cancelled || !snapshot) return;
          if (Number.isFinite(snapshot.price) && snapshot.price > 0) setPrice(snapshot.price);
          if (Number.isFinite(snapshot.change24h)) setChange24h(snapshot.change24h);
        } catch { /* keep candle close */ }
      };
      load();
      updateSnapshot();
      const candleId = setInterval(load, 20_000);
      const tickerId = setInterval(updateSnapshot, 5000);
      return () => { cancelled = true; clearInterval(candleId); clearInterval(tickerId); };
    }

    // Simulated path (no live source mapped)
    const seed = fallbackSeed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const sim = seededCandles(seed, basePrice, tfMs, 60);
    setCandles(sim);
    setPrice(sim[sim.length - 1].c);

    const id = setInterval(() => {
      setCandles(prev => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        const drift = (Math.random() - 0.5) * basePrice * 0.0006;
        const c = +(last.c + drift).toFixed(8);
        const h = Math.max(last.h, c);
        const l = Math.min(last.l, c);
        const updated = { ...last, c, h, l };
        const next = prev.slice(0, -1);
        next.push(updated);
        // roll a new candle when current bucket expires
        if (Date.now() - last.t > tfMs) {
          next.push({ t: last.t + tfMs, o: c, h: c, l: c, c, v: 0 });
          return next.slice(-60);
        }
        setPrice(c);
        return next;
      });
    }, 1200);
    return () => { cancelled = true; clearInterval(id); };
  }, [binanceSymbol, yahooSymbol, fallbackSeed, basePrice, timeframe, tfMs]);

  return { candles, price, change24h };
}

export function useMarketSnapshots(markets: { binance?: string; yahoo?: string; price: number; change24h: number }[]) {
  const [snapshots, setSnapshots] = useState<Record<number, MarketSnapshot>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next: Record<number, MarketSnapshot> = {};
      await Promise.all([
        Promise.all(markets.map(async (m, idx) => {
          if (!m.binance) return;
          try {
            const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${m.binance}`);
            const row = await r.json();
            const price = Number(row.lastPrice);
            const change24h = Number(row.priceChangePercent);
            if (Number.isFinite(price)) next[idx] = { price, change24h: Number.isFinite(change24h) ? change24h : m.change24h };
          } catch { /* keep fallback */ }
        })),
        (async () => {
          const yahooSymbols = markets.map((m) => m.yahoo).filter((s): s is string => !!s);
          if (!yahooSymbols.length) return;
          try {
            const { snapshots: yahooSnapshots } = await fetchYahooSnapshots({ data: { symbols: yahooSymbols } });
            markets.forEach((m, idx) => {
              if (m.yahoo && yahooSnapshots[m.yahoo]) next[idx] = yahooSnapshots[m.yahoo];
            });
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