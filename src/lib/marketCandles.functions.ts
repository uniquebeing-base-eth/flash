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
    const price = Number(r.meta?.regularMarketPrice ?? out.at(-1)?.c ?? 0);
    const previous = Number(r.meta?.previousClose ?? r.meta?.chartPreviousClose ?? out.at(-2)?.c ?? price);
    const change24h = previous ? ((price - previous) / previous) * 100 : 0;
    return { candles: out.slice(-60), price, change24h };
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