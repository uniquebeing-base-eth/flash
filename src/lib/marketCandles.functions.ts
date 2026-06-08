import { createServerFn } from "@tanstack/react-start";

type CandleDto = { t: number; o: number; h: number; l: number; c: number; v: number };

const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; FlashApp/1.0)" };
const TF_MAP: Record<string, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "1d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "5d" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "60m", range: "1mo" },
  "4h": { interval: "60m", range: "3mo" },
  "1d": { interval: "1d", range: "1y" },
};

const BINANCE_TF: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d",
};

// Binance has multiple data hosts; some are geo-restricted. Try in order.
const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
];

async function binanceFetch(path: string): Promise<unknown> {
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`);
      if (!res.ok) { lastErr = new Error(`Binance ${res.status}`); continue; }
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("Binance unreachable");
}

async function loadYahooChart(symbol: string, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  return await res.json() as {
    chart: {
      result?: Array<{
        meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number };
        timestamp: number[];
        indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume?: number[] }> };
      }>;
    };
  };
}

function aggregateCandles(candles: CandleDto[], bucketMs: number): CandleDto[] {
  const grouped = new Map<number, CandleDto>();
  for (const candle of candles) {
    const t = Math.floor(candle.t / bucketMs) * bucketMs;
    const current = grouped.get(t);
    if (!current) {
      grouped.set(t, { ...candle, t });
    } else {
      current.h = Math.max(current.h, candle.h);
      current.l = Math.min(current.l, candle.l);
      current.c = candle.c;
      current.v += candle.v;
    }
  }
  return Array.from(grouped.values()).sort((a, b) => a.t - b.t);
}

/**
 * Fetch real OHLC candles from Yahoo Finance for forex / commodities.
 * Server-side proxy avoids browser CORS issues with query1.finance.yahoo.com.
 */
export const fetchYahooCandles = createServerFn({ method: "GET" })
  .inputValidator((d: { symbol: string; timeframe: string }) => d)
  .handler(async ({ data }) => {
    const { symbol, timeframe } = data;
    const { interval, range } = TF_MAP[timeframe] ?? TF_MAP["1h"];
    const json = await loadYahooChart(symbol, interval, range);
    const r = json.chart?.result?.[0];
    if (!r) return { candles: [] as CandleDto[], price: 0, change24h: 0 };
    const q = r.indicators.quote[0];
    const out: CandleDto[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ t: r.timestamp[i] * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
    }
    const candles = timeframe === "4h" ? aggregateCandles(out, 14_400_000) : out;
    const price = Number(r.meta?.regularMarketPrice ?? out.at(-1)?.c ?? 0);
    const previous = Number(r.meta?.previousClose ?? r.meta?.chartPreviousClose ?? out.at(-2)?.c ?? price);
    const change24h = previous ? ((price - previous) / previous) * 100 : 0;
    return { candles: candles.slice(-60), price, change24h };
  });

export const fetchYahooSnapshots = createServerFn({ method: "GET" })
  .inputValidator((d: { symbols: string[] }) => ({ symbols: d.symbols.slice(0, 12) }))
  .handler(async ({ data }) => {
    const entries = await Promise.all(data.symbols.map(async (symbol) => {
      const json = await loadYahooChart(symbol, "1d", "5d");
      const r = json.chart?.result?.[0];
      const q = r?.indicators.quote[0];
      const closes = q?.close?.filter((v): v is number => typeof v === "number") ?? [];
      const price = Number(r?.meta?.regularMarketPrice ?? closes.at(-1) ?? 0);
      const previous = Number(r?.meta?.previousClose ?? r?.meta?.chartPreviousClose ?? closes.at(-2) ?? price);
      const change24h = previous ? ((price - previous) / previous) * 100 : 0;
      return [symbol, { price, change24h }] as const;
    }));
    return { snapshots: Object.fromEntries(entries) as Record<string, { price: number; change24h: number }> };
  });

/**
 * Server-side Binance proxy. Binance API is often geo-blocked from end-user
 * browsers (HTTP 451), but reachable from our Cloudflare Worker.
 */
export const fetchBinanceCandles = createServerFn({ method: "GET" })
  .inputValidator((d: { symbol: string; timeframe: string }) => d)
  .handler(async ({ data }) => {
    const tf = BINANCE_TF[data.timeframe] ?? "1h";
    const rows = (await binanceFetch(`/api/v3/klines?symbol=${data.symbol}&interval=${tf}&limit=60`)) as unknown[][];
    const candles: CandleDto[] = rows.map((r) => ({
      t: Number(r[0]),
      o: parseFloat(String(r[1])),
      h: parseFloat(String(r[2])),
      l: parseFloat(String(r[3])),
      c: parseFloat(String(r[4])),
      v: parseFloat(String(r[5])),
    }));
    const ticker = (await binanceFetch(`/api/v3/ticker/24hr?symbol=${data.symbol}`)) as { lastPrice: string; priceChangePercent: string };
    return {
      candles,
      price: Number(ticker.lastPrice) || candles.at(-1)?.c || 0,
      change24h: Number(ticker.priceChangePercent) || 0,
    };
  });

export const fetchBinanceSnapshots = createServerFn({ method: "GET" })
  .inputValidator((d: { symbols: string[] }) => ({ symbols: d.symbols.slice(0, 24) }))
  .handler(async ({ data }) => {
    if (!data.symbols.length) return { snapshots: {} as Record<string, { price: number; change24h: number }> };
    const qs = encodeURIComponent(JSON.stringify(data.symbols));
    try {
      const rows = (await binanceFetch(`/api/v3/ticker/24hr?symbols=${qs}`)) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>;
      const snapshots: Record<string, { price: number; change24h: number }> = {};
      for (const row of rows) {
        snapshots[row.symbol] = { price: Number(row.lastPrice) || 0, change24h: Number(row.priceChangePercent) || 0 };
      }
      return { snapshots };
    } catch {
      // Fallback: fetch one by one
      const entries = await Promise.all(data.symbols.map(async (symbol) => {
        try {
          const row = (await binanceFetch(`/api/v3/ticker/24hr?symbol=${symbol}`)) as { lastPrice: string; priceChangePercent: string };
          return [symbol, { price: Number(row.lastPrice) || 0, change24h: Number(row.priceChangePercent) || 0 }] as const;
        } catch {
          return [symbol, { price: 0, change24h: 0 }] as const;
        }
      }));
      return { snapshots: Object.fromEntries(entries) };
    }
  });