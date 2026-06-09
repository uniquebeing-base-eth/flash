import { BrowserProvider, Contract, parseUnits, MaxUint256 } from "ethers";
import { DEPOSIT_FEE_USD, CELO_FEE_TREASURY, assertCeloFeeTreasury } from "./fees";
import { logEvent } from "./logger";
import { withRetry } from "./rpc";

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

/* ============================================================== */
/* Deposit state machine — persisted in localStorage for recovery */
/* ============================================================== */

export type DepositStatus =
  | "INITIATED"
  | "FEE_PAID"
  | "BRIDGING"
  | "COMPLETED"
  | "FAILED";

export interface DepositRecord {
  id: string;
  wallet: string;
  amountCusd: string;        // gross amount user typed
  feeCusd: string;           // DEPOSIT_FEE_USD
  netCusd: string;           // amountCusd - feeCusd
  status: DepositStatus;
  feeTxHash?: string;
  bridgeTxHash?: string;
  squidStatus?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const STORE_KEY = "flash.deposits";

function readStore(): Record<string, DepositRecord> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, DepositRecord>; }
  catch { return {}; }
}
function writeStore(s: Record<string, DepositRecord>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}
function upsert(rec: DepositRecord) {
  const s = readStore();
  s[rec.id] = { ...rec, updatedAt: Date.now() };
  writeStore(s);
}
export function getDeposit(id: string): DepositRecord | undefined { return readStore()[id]; }
export function listDeposits(wallet: string): DepositRecord[] {
  return Object.values(readStore()).filter(d => d.wallet.toLowerCase() === wallet.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt);
}

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
  return withRetry(async () => {
    const res = await fetch("https://v2.api.squidrouter.com/v2/route", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-integrator-id": SQUID_INTEGRATOR_ID },
      body: JSON.stringify(params),
    });
    const json = await res.json().catch(() => null) as (SquidRouteResponse & { error?: unknown }) | null;
    if (!res.ok || !json?.route) {
      const error = typeof json?.error === "string" ? json.error : `Squid route failed (${res.status})`;
      throw new Error(error);
    }
    return json;
  }, 3, 1000);
}

/** Poll the Squid status endpoint until success/error. */
export async function pollSquidStatus(txHash: string, opts: { onTick?: (s: string) => void; timeoutMs?: number } = {}): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `https://apiplus.squidrouter.com/v2/status?transactionId=${txHash}&fromChainId=${CELO_CHAIN_ID}&toChainId=${ARBITRUM_CHAIN_ID}`,
        { headers: { "x-integrator-id": SQUID_INTEGRATOR_ID } },
      );
      const json = await res.json() as { squidTransactionStatus?: string; status?: string; error?: { message?: string } };
      const status = (json.squidTransactionStatus ?? json.status ?? "ongoing").toLowerCase();
      opts.onTick?.(status);
      if (status === "success") return "success";
      if (status === "partial_success" || status === "needs_gas" || status === "not_found") {
        // transient — keep polling
      } else if (status === "error" || status === "failed") {
        throw new Error(json.error?.message ?? "Squid reported failure");
      }
    } catch (e) {
      // network blip — keep polling
      // eslint-disable-next-line no-console
      console.warn("squid status poll error", e);
    }
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error("Bridge timed out after 10 minutes");
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
  const net = Math.max(0, parseFloat(amountCusdHuman) - DEPOSIT_FEE_USD).toString();
  if (parseFloat(net) <= 0) throw new Error(`Amount must exceed $${DEPOSIT_FEE_USD} fee.`);
  const { route } = await getSquidRoute({
    fromAddress,
    fromChain: CELO_CHAIN_ID,
    fromToken: CUSD_CELO,
    fromAmount: parseUnits(net, 18).toString(),
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
 * Full deposit pipeline:
 *   1. Collect $0.05 fee in cUSD → CELO_FEE_TREASURY
 *   2. Bridge net amount Celo cUSD → Arbitrum USDC to user's own wallet via Squid
 *   3. Persist state for status polling / recovery
 */
export async function bridgeDeposit(
  amountCusdHuman: string,
  opts: { onStatus?: (rec: DepositRecord) => void } = {},
): Promise<DepositRecord> {
  assertCeloFeeTreasury();
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const fromAddress = await signer.getAddress();

  // Ensure wallet is on Celo before any signing
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== Number(CELO_CHAIN_ID)) {
    try {
      await window.ethereum!.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xa4ec" }],
      });
    } catch {
      throw new Error("Switch wallet to Celo to deposit.");
    }
  }

  const gross = parseFloat(amountCusdHuman);
  const net = +(gross - DEPOSIT_FEE_USD).toFixed(6);
  if (!(net > 0)) throw new Error(`Deposit must exceed $${DEPOSIT_FEE_USD} fee.`);

  const id = crypto.randomUUID();
  const rec: DepositRecord = {
    id, wallet: fromAddress,
    amountCusd: amountCusdHuman,
    feeCusd: DEPOSIT_FEE_USD.toFixed(2),
    netCusd: net.toString(),
    status: "INITIATED",
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  upsert(rec); logEvent({ flow: "deposit", step: "initiated", status: "info", id });
  opts.onStatus?.(rec);

  // 1. Fee transfer
  try {
    const erc20Abi = [
      "function transfer(address to, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)",
    ];
    const cusd = new Contract(CUSD_CELO, erc20Abi, signer);
    const feeTx = await cusd.transfer(CELO_FEE_TREASURY, parseUnits(DEPOSIT_FEE_USD.toString(), 18));
    await feeTx.wait();
    rec.feeTxHash = feeTx.hash; rec.status = "FEE_PAID"; upsert(rec);
    logEvent({ flow: "deposit", step: "fee_paid", status: "ok", id, txHash: feeTx.hash });
    opts.onStatus?.(rec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fee transfer failed";
    rec.status = "FAILED"; rec.error = msg; upsert(rec);
    logEvent({ flow: "deposit", step: "fee_paid", status: "error", id, error: msg });
    opts.onStatus?.(rec);
    throw e;
  }

  const fromAmount = parseUnits(net.toString(), 18).toString();

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

  // 2. Approve Squid router to pull cUSD (max approval — saves gas on subsequent deposits)
  const erc20ApproveAbi = [
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
  ];
  const cusdA = new Contract(CUSD_CELO, erc20ApproveAbi, signer);
  const allowance: bigint = await cusdA.allowance(fromAddress, target);
  if (allowance < BigInt(fromAmount)) {
    const tx = await cusdA.approve(target, MaxUint256);
    await tx.wait();
  }

  try {
    const tx = await signer.sendTransaction({
      to: target,
      data: route.transactionRequest.data,
      value: route.transactionRequest.value ?? "0",
      chainId: Number(CELO_CHAIN_ID),
    });
    await tx.wait();
    rec.bridgeTxHash = tx.hash; rec.status = "BRIDGING"; upsert(rec);
    logEvent({ flow: "deposit", step: "bridging", status: "info", id, txHash: tx.hash });
    opts.onStatus?.(rec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bridge tx failed";
    rec.status = "FAILED"; rec.error = msg; upsert(rec);
    logEvent({ flow: "deposit", step: "bridging", status: "error", id, error: msg });
    opts.onStatus?.(rec);
    throw e;
  }

  // 3. Async poll status (do not block UI)
  void (async () => {
    try {
      await pollSquidStatus(rec.bridgeTxHash!, {
        onTick: (s) => { rec.squidStatus = s; upsert(rec); opts.onStatus?.(rec); },
      });
      rec.status = "COMPLETED"; upsert(rec);
      logEvent({ flow: "deposit", step: "completed", status: "ok", id, txHash: rec.bridgeTxHash });
      opts.onStatus?.(rec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bridge polling failed";
      rec.status = "FAILED"; rec.error = msg; upsert(rec);
      logEvent({ flow: "deposit", step: "completed", status: "error", id, error: msg });
      opts.onStatus?.(rec);
    }
  })();

  return rec;
}