import { createServerFn } from "@tanstack/react-start";

const SUBSQUID = "https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql";
const GMX_API = "https://arbitrum-api.gmxinfra.io";

export interface RawPosition {
  id: string;
  account: string;
  marketAddress: string;
  collateralTokenAddress: string;
  isLong: boolean;
  sizeInUsd: string;       // 30 decimals
  sizeInTokens: string;
  collateralAmount: string; // collateral token decimals
  entryPrice: string;       // 30-tokenDecimals
}

export interface RawOrder {
  id: string;
  account: string;
  marketAddress: string;
  orderType: number;       // 2=MarketIncrease,4=LimitDecrease,5=StopLossDecrease,6=Liquidation,7=StopIncrease
  isLong: boolean;
  triggerPrice: string;
  sizeDeltaUsd: string;
  status: string;
}

export const fetchGmxPositions = createServerFn({ method: "POST" })
  .inputValidator((d: { account: string }) => d)
  .handler(async ({ data }) => {
    const account = data.account.toLowerCase();
    const query = `
      query Q($acc: String!) {
        positions(where: { account_eq: $acc, sizeInUsd_gt: "0" }, limit: 50) {
          id account marketAddress collateralTokenAddress isLong
          sizeInUsd sizeInTokens collateralAmount entryPrice
        }
        orders(where: { account_eq: $acc, status_eq: "Created" }, limit: 50) {
          id account marketAddress orderType isLong triggerPrice sizeDeltaUsd status
        }
      }`;
    try {
      const res = await fetch(SUBSQUID, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { acc: account } }),
      });
      const json = await res.json() as {
        data?: { positions: RawPosition[]; orders: RawOrder[] };
        errors?: unknown;
      };
      return {
        positions: json.data?.positions ?? [],
        orders: json.data?.orders ?? [],
      };
    } catch {
      return { positions: [] as RawPosition[], orders: [] as RawOrder[] };
    }
  });

export interface PriceRow { tokenAddress: string; minPrice: string; maxPrice: string }

export const fetchGmxTickers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ tickers: PriceRow[] }> => {
    try {
      const res = await fetch(`${GMX_API}/prices/tickers`);
      if (!res.ok) return { tickers: [] };
      const arr = await res.json() as PriceRow[];
      return { tickers: arr };
    } catch {
      return { tickers: [] };
    }
  },
);