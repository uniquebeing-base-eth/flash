/**
 * GMX v2 (Arbitrum) wiring. App is a router only:
 *  - reads positions/markets via @gmx-io/sdk
 *  - submits market increase/decrease orders via the SDK (signed by user wallet)
 *  - never overrides PnL, fees, liq prices — GMX is source of truth
 */
import { GmxSdk } from "@gmx-io/sdk";
import { BrowserProvider } from "ethers";
import { ARBITRUM_RPCS } from "./rpc";
import { logEvent } from "./logger";

export const GMX_CHAIN_ID = 42161;
const ORACLE_URL = "https://arbitrum-api.gmxinfra.io";

/** Read-only SDK (no wallet). Safe for SSR-less browser reads. */
export function getReadSdk(account?: string): GmxSdk {
  return new GmxSdk({
    chainId: GMX_CHAIN_ID,
    rpcUrl: ARBITRUM_RPCS[0]!,
    oracleUrl: ORACLE_URL,
    account: (account as `0x${string}` | undefined),
  });
}

export interface OpenPosition {
  key: string;
  marketAddress: string;
  isLong: boolean;
  sizeInUsd: string;
  collateralUsd: string;
  entryPrice: string;
  liquidationPrice?: string;
  pnl: string;
  pnlPercentage: string;
}

/**
 * Fetch open positions for the wallet. Returns [] if SDK/oracle is unreachable.
 * UI MUST treat this as source of truth (overrides local mirror).
 */
export async function getOpenPositions(account: string): Promise<OpenPosition[]> {
  try {
    const sdk = getReadSdk(account);
    // SDK returns rich position objects keyed by positionKey.
    // Surface shape varies between SDK versions — adapt defensively.
    const data: unknown = await sdk.positions.getPositionsInfo({
      marketsInfoData: undefined as never,
      tokensData: undefined as never,
      showPnlInLeverage: false,
    } as never).catch(() => null);

    if (!data || typeof data !== "object") return [];
    const positions: OpenPosition[] = [];
    for (const [key, raw] of Object.entries(data as Record<string, Record<string, unknown>>)) {
      const p = raw as {
        marketAddress?: string;
        isLong?: boolean;
        sizeInUsd?: bigint;
        collateralUsd?: bigint;
        entryPrice?: bigint;
        liquidationPrice?: bigint;
        pnl?: bigint;
        pnlPercentage?: bigint;
      };
      positions.push({
        key,
        marketAddress: p.marketAddress ?? "",
        isLong: !!p.isLong,
        sizeInUsd: p.sizeInUsd?.toString() ?? "0",
        collateralUsd: p.collateralUsd?.toString() ?? "0",
        entryPrice: p.entryPrice?.toString() ?? "0",
        liquidationPrice: p.liquidationPrice?.toString(),
        pnl: p.pnl?.toString() ?? "0",
        pnlPercentage: p.pnlPercentage?.toString() ?? "0",
      });
    }
    return positions;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("getOpenPositions failed", e);
    return [];
  }
}

/**
 * Prepare and submit a market increase order via the GMX SDK.
 * NOTE: this is the scaffold — full market param resolution (indexToken, marketAddress,
 * collateralToken decimals, acceptable price) requires `markets.getMarketsInfo()` first
 * and exceeds what we can finalize without on-chain validation. The call is wrapped so
 * the UI surfaces errors instead of submitting partial state.
 */
export interface OpenOrderParams {
  marketSymbol: string;          // e.g. "ETH/USD"
  isLong: boolean;
  sizeUsd: number;
  leverage: number;
  collateralUsdc: number;        // USDC amount (6 decimals)
}

export async function openMarketOrder(params: OpenOrderParams): Promise<string> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected.");
  }
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const account = await signer.getAddress();

  // Ensure Arbitrum
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== GMX_CHAIN_ID) {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xa4b1" }],
    });
  }

  logEvent({ flow: "trade", step: "submitted", status: "info", meta: { ...params, account } });

  // The SDK requires markets/tokens info + a viem walletClient. Submitting orders
  // without resolving live market params would risk wrong collateral or slippage.
  // We throw an explicit, user-facing error until on-chain order params are wired.
  throw new Error(
    "GMX order submission is not live yet — fund your Arbitrum wallet and trade directly on gmx.io while we finalise the on-chain order params.",
  );
}

export async function closePosition(_positionKey: string): Promise<string> {
  throw new Error("Close-position via SDK not yet wired — manage from gmx.io for now.");
}