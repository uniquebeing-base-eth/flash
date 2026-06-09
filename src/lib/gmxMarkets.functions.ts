import { createServerFn } from "@tanstack/react-start";

/**
 * Server-side proxy for GMX v2 public APIs on Arbitrum.
 * These endpoints are CORS-restricted from the browser in some networks,
 * so we always go through the Worker.
 */

const GMX_API = "https://arbitrum-api.gmxinfra.io";

export interface GmxToken {
  address: string;
  symbol: string;
  decimals: number;
  isSynthetic?: boolean;
  isStable?: boolean;
}

export interface GmxMarket {
  marketToken: string;        // market address
  indexToken: string;
  longToken: string;
  shortToken: string;
  indexSymbol: string;
  name: string;
  isSpotOnly?: boolean;
}

export interface GmxTicker {
  tokenAddress: string;
  tokenSymbol: string;
  minPrice: string;
  maxPrice: string;
  updatedAt: number;
}

export interface GmxMarketRow {
  marketToken: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  symbol: string;          // e.g. "ETH/USD"
  indexSymbol: string;     // e.g. "ETH"
  name: string;
  price: number;
  change24h: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${GMX_API}${path}`);
  if (!res.ok) throw new Error(`GMX ${path} ${res.status}`);
  return await res.json() as T;
}

/**
 * Fetch all tradable GMX v2 markets joined with live oracle prices.
 * Filters out spot-only markets. Returns one row per perp market.
 */
export const fetchGmxMarkets = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ markets: GmxMarketRow[]; updatedAt: number }> => {
    const [tokensJson, marketsJson, tickersJson] = await Promise.all([
      get<{ tokens: GmxToken[] }>("/tokens"),
      get<{ markets: GmxMarket[] }>("/markets"),
      get<GmxTicker[]>("/prices/tickers"),
    ]);

    const tokenBySymbol = new Map<string, GmxToken>();
    const tokenByAddr = new Map<string, GmxToken>();
    for (const t of tokensJson.tokens ?? []) {
      tokenBySymbol.set(t.symbol.toUpperCase(), t);
      tokenByAddr.set(t.address.toLowerCase(), t);
    }

    const tickerByAddr = new Map<string, GmxTicker>();
    for (const t of tickersJson ?? []) {
      tickerByAddr.set(t.tokenAddress.toLowerCase(), t);
    }

    const rows: GmxMarketRow[] = [];
    const seen = new Set<string>();
    for (const m of marketsJson.markets ?? []) {
      if (m.isSpotOnly) continue;
      const idxTok = tokenByAddr.get(m.indexToken.toLowerCase());
      if (!idxTok) continue;
      const ticker = tickerByAddr.get(m.indexToken.toLowerCase());
      if (!ticker) continue;
      const symbol = `${idxTok.symbol}/USD`;
      if (seen.has(symbol)) continue; // first market wins (single-collateral)
      seen.add(symbol);

      const minP = Number(ticker.minPrice);
      const maxP = Number(ticker.maxPrice);
      // GMX prices have 30 - tokenDecimals total decimals
      const priceDecimals = 30 - idxTok.decimals;
      const price = ((minP + maxP) / 2) / Math.pow(10, priceDecimals);

      rows.push({
        marketToken: m.marketToken,
        indexToken: m.indexToken,
        longToken: m.longToken,
        shortToken: m.shortToken,
        symbol,
        indexSymbol: idxTok.symbol,
        name: m.name || idxTok.symbol,
        price,
        change24h: 0, // filled client-side from Binance 24h
      });
    }

    return { markets: rows, updatedAt: Date.now() };
  },
);