import { Squid } from "@0xsquid/sdk";
import { BrowserProvider, Contract, parseUnits, MaxUint256 } from "ethers";

/**
 * Squid Router bridge: Celo cUSD -> Arbitrum USDC.
 *
 * Why: Hyperliquid (and most perp venues) settle in USDC on Arbitrum.
 * MiniPay users hold cUSD on Celo, so every deposit is bridged in one
 * signed tx into the Flash treasury on Arbitrum, which funds the
 * trading sub-account off-chain. Withdrawals are the reverse leg,
 * signed by the treasury server-side (not implemented here).
 */

export const CELO_CHAIN_ID = "42220";
export const ARBITRUM_CHAIN_ID = "42161";
export const CUSD_CELO = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
export const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

export const SQUID_INTEGRATOR_ID =
  (import.meta.env.VITE_SQUID_INTEGRATOR_ID as string | undefined) ?? "";
export const FLASH_TREASURY_ARB =
  (import.meta.env.VITE_FLASH_TREASURY_ARB as string | undefined) ?? "";

let _squid: Squid | null = null;
async function getSquid(): Promise<Squid> {
  if (_squid) return _squid;
  if (!SQUID_INTEGRATOR_ID) {
    throw new Error("Missing VITE_SQUID_INTEGRATOR_ID. Get one at app.squidrouter.com.");
  }
  const sdk = new Squid({
    baseUrl: "https://v2.api.squidrouter.com",
    integratorId: SQUID_INTEGRATOR_ID,
  });
  await sdk.init();
  _squid = sdk;
  return sdk;
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
  const squid = await getSquid();
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const fromAddress = await signer.getAddress();

  const { route } = await squid.getRoute({
    fromAddress,
    fromChain: CELO_CHAIN_ID,
    fromToken: CUSD_CELO,
    fromAmount: parseUnits(amountCusdHuman, 18).toString(),
    toChain: ARBITRUM_CHAIN_ID,
    toToken: USDC_ARB,
    toAddress: FLASH_TREASURY_ARB || fromAddress,
  });

  const est = route.estimate;
  return {
    toAmount: (Number(est.toAmount) / 1e6).toFixed(4),
    toAmountMin: (Number(est.toAmountMin) / 1e6).toFixed(4),
    estimatedRouteDuration: Number(est.estimatedRouteDuration ?? 0),
    feeUsd: est.aggregatePriceImpact ?? "0",
  };
}

/**
 * Bridge cUSD on Celo -> USDC on Arbitrum into the Flash treasury.
 * Approves cUSD spend if needed, then submits the Squid swap tx.
 * Returns the source-chain tx hash (trackable on Axelarscan).
 */
export async function bridgeDeposit(amountCusdHuman: string): Promise<string> {
  if (!FLASH_TREASURY_ARB) {
    throw new Error("Treasury not configured. Set VITE_FLASH_TREASURY_ARB.");
  }
  const squid = await getSquid();
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const fromAddress = await signer.getAddress();
  const fromAmount = parseUnits(amountCusdHuman, 18).toString();

  const { route } = await squid.getRoute({
    fromAddress,
    fromChain: CELO_CHAIN_ID,
    fromToken: CUSD_CELO,
    fromAmount,
    toChain: ARBITRUM_CHAIN_ID,
    toToken: USDC_ARB,
    toAddress: FLASH_TREASURY_ARB,
  });

  if (!route.transactionRequest || !("target" in route.transactionRequest)) {
    throw new Error("Squid returned no executable transaction request.");
  }
  const target = route.transactionRequest.target as string;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txResponse: any = await squid.executeRoute({ signer: signer as any, route });
  const hash: string = txResponse?.hash ?? txResponse?.transactionHash ?? "";
  if (txResponse?.wait) await txResponse.wait();
  return hash;
}