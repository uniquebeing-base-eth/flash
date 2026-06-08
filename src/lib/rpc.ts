import { JsonRpcProvider, FallbackProvider } from "ethers";

export const ARBITRUM_RPCS: string[] = [
  (import.meta.env.VITE_ARBITRUM_RPC_URL as string | undefined) ?? "",
  "https://arb1.arbitrum.io/rpc",
  "https://arbitrum.llamarpc.com",
].filter(Boolean);

export const CELO_RPCS: string[] = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
];

export function arbitrumReadProvider() {
  const providers = ARBITRUM_RPCS.map((url, i) => ({
    provider: new JsonRpcProvider(url, 42161),
    priority: i + 1,
    stallTimeout: 1500,
  }));
  if (providers.length === 1) return providers[0].provider;
  return new FallbackProvider(providers, 42161, { quorum: 1 });
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * Math.pow(2.5, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}