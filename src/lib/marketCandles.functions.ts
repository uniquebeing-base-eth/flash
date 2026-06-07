import { createServerFn } from "@tanstack/react-start";

/**
 * Fetch real OHLC candles from Yahoo Finance for forex / commodities.
 * Server-side proxy avoids browser CORS issues with query1.finance.yahoo.com.
 */
export const fetchYahooCandles = createServerFn({ method: "GET" })
  .inputValidator((d: { symbol: string; timeframe: string }) => d)
  .handler(async ({ data }) => {
    const { symbol, timeframe } = data;
    // Yahoo accepts: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
    const tfMap: Record<string, { interval: string; range: string }> = {
      "1m": { interval: "1m", range: "1d" },
      "5m": { interval: "5m", range: "5d" },
      "15m": { interval: "15m", range: "5d" },
      "30m": { interval: "30m", range: "1mo" },
      "1h": { interval: "60m", range: "1mo" },
      "4h": { interval: "60m", range: "3mo" },
      "1d": { interval: "1d", range: "1y" },
    };
    const { interval, range } = tfMap[timeframe] ?? tfMap["1h"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlashApp/1.0)" },
    });
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    const json = (await res.json()) as {
      chart: {
        result?: Array<{
          timestamp: number[];
          indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> };
        }>;
        error?: unknown;
      };
    };
    const r = json.chart?.result?.[0];
    if (!r) return { candles: [] as { t: number; o: number; h: number; l: number; c: number; v: number }[] };
    const q = r.indicators.quote[0];
    const out: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ t: r.timestamp[i] * 1000, o, h, l, c, v: q.volume[i] ?? 0 });
    }
    return { candles: out.slice(-60) };
  });