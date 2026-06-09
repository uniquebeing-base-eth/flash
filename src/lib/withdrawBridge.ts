import { BrowserProvider, Contract, parseUnits, MaxUint256 } from "ethers";
import { ARB_FEE_TREASURY, WITHDRAW_FEE_USD, assertArbFeeTreasury } from "./fees";
import { logEvent } from "./logger";
import { withRetry, arbitrumReadProvider } from "./rpc";
import { pollSquidStatus, SQUID_INTEGRATOR_ID, USDC_ARB, CUSD_CELO, ARBITRUM_CHAIN_ID, CELO_CHAIN_ID } from "./squidBridge";
import { fetchGmxPositions } from "./gmxPositions.functions";

export type WithdrawStatus =
  | "INITIATED"
  | "POSITION_CLOSING"
  | "FEE_PAID"
  | "BRIDGING_BACK"
  | "COMPLETED"
  | "FAILED";

export interface WithdrawRecord {
  id: string;
  wallet: string;
  amountUsdc: string;
  feeUsdc: string;
  netUsdc: string;
  status: WithdrawStatus;
  feeTxHash?: string;
  bridgeTxHash?: string;
  squidStatus?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const KEY = "flash.withdrawals";
function read(): Record<string, WithdrawRecord> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, WithdrawRecord>; } catch { return {}; }
}
function write(s: Record<string, WithdrawRecord>) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}
function upsert(r: WithdrawRecord) {
  const s = read(); s[r.id] = { ...r, updatedAt: Date.now() }; write(s);
}
export function listWithdrawals(wallet: string): WithdrawRecord[] {
  return Object.values(read())
    .filter(w => w.wallet.toLowerCase() === wallet.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt);
}

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export async function getArbUsdcBalance(wallet: string): Promise<string> {
  const provider = arbitrumReadProvider();
  const c = new Contract(USDC_ARB, USDC_ABI, provider);
  const raw: bigint = await c.balanceOf(wallet);
  return (Number(raw) / 1e6).toString();
}

interface SquidRouteResponse {
  route: {
    estimate: { toAmount: string; toAmountMin: string; estimatedRouteDuration?: number | string };
    transactionRequest?: { target?: string; data?: string; value?: string };
  };
}

async function squidRoute(params: Record<string, string | number>): Promise<SquidRouteResponse> {
  if (!SQUID_INTEGRATOR_ID) throw new Error("Missing VITE_SQUID_INTEGRATOR_ID.");
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

export interface WithdrawQuote {
  toAmount: string;
  toAmountMin: string;
  estimatedRouteDuration: number;
}

export async function quoteWithdraw(amountUsdcHuman: string, recipientCelo: string): Promise<WithdrawQuote> {
  const net = Math.max(0, parseFloat(amountUsdcHuman) - WITHDRAW_FEE_USD);
  if (!(net > 0)) throw new Error(`Amount must exceed $${WITHDRAW_FEE_USD} fee.`);
  const provider = new BrowserProvider(window.ethereum!);
  const signer = await provider.getSigner();
  const from = await signer.getAddress();
  const { route } = await squidRoute({
    fromAddress: from,
    fromChain: ARBITRUM_CHAIN_ID,
    fromToken: USDC_ARB,
    fromAmount: parseUnits(net.toFixed(6), 6).toString(),
    toChain: CELO_CHAIN_ID,
    toToken: CUSD_CELO,
    toAddress: recipientCelo,
  });
  return {
    toAmount: (Number(route.estimate.toAmount) / 1e18).toFixed(4),
    toAmountMin: (Number(route.estimate.toAmountMin) / 1e18).toFixed(4),
    estimatedRouteDuration: Number(route.estimate.estimatedRouteDuration ?? 0),
  };
}

export async function bridgeWithdraw(
  amountUsdcHuman: string,
  recipientCelo: string,
  opts: { onStatus?: (r: WithdrawRecord) => void } = {},
): Promise<WithdrawRecord> {
  assertArbFeeTreasury();
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No wallet detected.");

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const from = await signer.getAddress();

  // Block if open GMX positions
  const posResp = await fetchGmxPositions({ data: { account: from } }).catch(() => ({ positions: [] as unknown[] }));
  if ((posResp.positions?.length ?? 0) > 0) {
    throw new Error("Close all open positions before withdrawing.");
  }

  const gross = parseFloat(amountUsdcHuman);
  const net = +(gross - WITHDRAW_FEE_USD).toFixed(6);
  if (!(net > 0)) throw new Error(`Withdraw must exceed $${WITHDRAW_FEE_USD} fee.`);

  const id = crypto.randomUUID();
  const rec: WithdrawRecord = {
    id, wallet: from,
    amountUsdc: amountUsdcHuman,
    feeUsdc: WITHDRAW_FEE_USD.toFixed(2),
    netUsdc: net.toString(),
    status: "INITIATED",
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  upsert(rec); logEvent({ flow: "withdraw", step: "initiated", status: "info", id });
  opts.onStatus?.(rec);

  // Ensure Arbitrum chain
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 42161) {
    try {
      await window.ethereum!.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xa4b1" }],
      });
    } catch {
      throw new Error("Switch wallet to Arbitrum to withdraw.");
    }
  }

  // 1. Fee transfer
  try {
    const usdc = new Contract(USDC_ARB, USDC_ABI, signer);
    const feeTx = await usdc.transfer(ARB_FEE_TREASURY, parseUnits(WITHDRAW_FEE_USD.toString(), 6));
    await feeTx.wait();
    rec.feeTxHash = feeTx.hash; rec.status = "FEE_PAID"; upsert(rec);
    logEvent({ flow: "withdraw", step: "fee_paid", status: "ok", id, txHash: feeTx.hash });
    opts.onStatus?.(rec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fee transfer failed";
    rec.status = "FAILED"; rec.error = msg; upsert(rec);
    logEvent({ flow: "withdraw", step: "fee_paid", status: "error", id, error: msg });
    opts.onStatus?.(rec); throw e;
  }

  // 2. Bridge back
  const { route } = await squidRoute({
    fromAddress: from,
    fromChain: ARBITRUM_CHAIN_ID,
    fromToken: USDC_ARB,
    fromAmount: parseUnits(net.toString(), 6).toString(),
    toChain: CELO_CHAIN_ID,
    toToken: CUSD_CELO,
    toAddress: recipientCelo,
  });
  if (!route.transactionRequest?.target || !route.transactionRequest.data) {
    throw new Error("Squid returned no executable tx.");
  }
  const target = route.transactionRequest.target;

  const usdcApprove = new Contract(USDC_ARB, USDC_ABI, signer);
  const allowance: bigint = await usdcApprove.allowance(from, target);
  if (allowance < parseUnits(net.toString(), 6)) {
    const a = await usdcApprove.approve(target, MaxUint256);
    await a.wait();
  }

  try {
    const tx = await signer.sendTransaction({
      to: target,
      data: route.transactionRequest.data,
      value: route.transactionRequest.value ?? "0",
      chainId: 42161,
    });
    await tx.wait();
    rec.bridgeTxHash = tx.hash; rec.status = "BRIDGING_BACK"; upsert(rec);
    logEvent({ flow: "withdraw", step: "bridging_back", status: "info", id, txHash: tx.hash });
    opts.onStatus?.(rec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bridge tx failed";
    rec.status = "FAILED"; rec.error = msg; upsert(rec);
    logEvent({ flow: "withdraw", step: "bridging_back", status: "error", id, error: msg });
    opts.onStatus?.(rec); throw e;
  }

  void (async () => {
    try {
      await pollSquidStatus(rec.bridgeTxHash!, {
        onTick: (s) => { rec.squidStatus = s; upsert(rec); opts.onStatus?.(rec); },
      });
      rec.status = "COMPLETED"; upsert(rec);
      logEvent({ flow: "withdraw", step: "completed", status: "ok", id, txHash: rec.bridgeTxHash });
      opts.onStatus?.(rec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bridge polling failed";
      rec.status = "FAILED"; rec.error = msg; upsert(rec);
      logEvent({ flow: "withdraw", step: "completed", status: "error", id, error: msg });
      opts.onStatus?.(rec);
    }
  })();

  return rec;
}