import { BrowserProvider, Contract, parseUnits, MaxUint256 } from "ethers";

/**
 * Squid Router bridge: Celo cUSD -> Arbitrum USDC.
 *
 * Why: GMX v2 perps use USDC collateral on Arbitrum.
 * MiniPay users hold cUSD on Celo, so every deposit is bridged in one
 * signed tx into the user's own Arbitrum wallet for non-custodial trading.
 */

export const CELO_CHAIN_ID = "42220";
export const ARBITRUM_CHAIN_ID = "42161";
export const CUSD_CELO = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
export const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

export const SQUID_INTEGRATOR_ID =
  (import.meta.env.VITE_SQUID_INTEGRATOR_ID as string | undefined) ?? "";

interface SquidRouteResponse {
  route: {
    estimate: {
      toAmount: string;
      toAmountMin: string;
      estimatedRouteDuration?: number | string;
      aggregatePriceImpact?: number | string;
    };
    transactionRequest?: {
      target?: string;
      data?: string;
      value?: string;
    };
  };
}

async function getSquidRoute(params: Record<string, string | number | boolean>): Promise<SquidRouteResponse> {
  if (!SQUID_INTEGRATOR_ID) {
    throw new Error("Missing VITE_SQUID_INTEGRATOR_ID. Get one at app.squidrouter.com.");
  }
  const res = await fetch("https://v2.api.squidrouter.com/v2/route", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-integrator-id": SQUID_INTEGRATOR_ID,
    },
    body: JSON.stringify(params),
  });
  const json = await res.json().catch(() => null) as (SquidRouteResponse & { error?: unknown }) | null;
  if (!res.ok || !json?.route) {
    const error = typeof json?.error === "string" ? json.error : `Squid route failed (${res.status})`;
    throw new Error(error);
  }
  return json;
}

function getBrowserProvider(): BrowserProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected. Open Flash inside MiniPay.");
  }
  return new BrowserProvider(window.ethereum);
}

export interface BridgeQuote {
  toAmount: string;        // human-readable USDC amount user will receive on Arbitrum
  toAmountMin: string;     // slippage-adjusted minimum
  estimatedRouteDuration: number; // seconds
  feeUsd: string;
}

export async function quoteDeposit(amountCusdHuman: string): Promise<BridgeQuote> {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const fromAddress = await signer.getAddress();

  const { route } = await getSquidRoute({
    fromAddress,
    fromChain: CELO_CHAIN_ID,
    fromToken: CUSD_CELO,
    fromAmount: parseUnits(amountCusdHuman, 18).toString(),
    toChain: ARBITRUM_CHAIN_ID,
    toToken: USDC_ARB,
    toAddress: fromAddress,
  });

  const est = route.estimate;
  return {
    toAmount: (Number(est.toAmount) / 1e6).toFixed(4),
    toAmountMin: (Number(est.toAmountMin) / 1e6).toFixed(4),
    estimatedRouteDuration: Number(est.estimatedRouteDuration ?? 0),
    feeUsd: String(est.aggregatePriceImpact ?? "0"),
  };
}

/**
 * Bridge cUSD on Celo -> USDC on Arbitrum into the user's own wallet.
 * Approves cUSD spend if needed, then submits the Squid swap tx.
 * Returns the source-chain tx hash (trackable on Axelarscan).
 */
export async function bridgeDeposit(amountCusdHuman: string): Promise<string> {
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const fromAddress = await signer.getAddress();
  const fromAmount = parseUnits(amountCusdHuman, 18).toString();

  const { route } = await getSquidRoute({
    fromAddress,
    fromChain: CELO_CHAIN_ID,
    fromToken: CUSD_CELO,
    fromAmount,
    toChain: ARBITRUM_CHAIN_ID,
    toToken: USDC_ARB,
    toAddress: fromAddress,
  });

  if (!route.transactionRequest?.target || !route.transactionRequest.data) {
    throw new Error("Squid returned no executable transaction request.");
  }
  const target = route.transactionRequest.target;

  // Approve Squid router to pull cUSD (max approval — saves gas on subsequent deposits)
  const erc20Abi = [
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
  ];
  const cusd = new Contract(CUSD_CELO, erc20Abi, signer);
  const allowance: bigint = await cusd.allowance(fromAddress, target);
  if (allowance < BigInt(fromAmount)) {
    const tx = await cusd.approve(target, MaxUint256);
    await tx.wait();
  }

  const tx = await signer.sendTransaction({
    to: target,
    data: route.transactionRequest.data,
    value: route.transactionRequest.value ?? "0",
    chainId: Number(CELO_CHAIN_ID),
  });
  await tx.wait();
  return tx.hash;
}