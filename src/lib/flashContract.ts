import { BrowserProvider, Contract, type Eip1193Provider } from "ethers";

/** Address of the deployed FlashUsernameRegistry. Set after deployment in .env */
export const FLASH_REGISTRY_ADDRESS =
  (import.meta.env.VITE_FLASH_REGISTRY_ADDRESS as string | undefined) ?? "";

export const FLASH_REGISTRY_ABI = [
  "function registerUser(string username) external",
  "function isAvailable(string username) external view returns (bool)",
  "function isRegistered(address wallet) external view returns (bool)",
  "function usernameOf(address wallet) external view returns (string)",
  "function totalUsers() external view returns (uint256)",
  "event UserRegistered(address indexed wallet, string username, uint256 timestamp)",
];

declare global {
  interface Window { ethereum?: Eip1193Provider; }
}

/** Celo Mainnet (MiniPay) — 42220 / 0xa4ec */
export const CELO_CHAIN_ID_HEX = "0xa4ec";

export async function connectWallet(): Promise<{ address: string; provider: BrowserProvider }> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected. Open Flash inside MiniPay.");
  }
  const provider = new BrowserProvider(window.ethereum);
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  return { address: accounts[0], provider };
}

export function getRegistry(provider: BrowserProvider, withSigner = false) {
  if (!FLASH_REGISTRY_ADDRESS) throw new Error("Registry address not configured (VITE_FLASH_REGISTRY_ADDRESS).");
  if (withSigner) {
    return provider.getSigner().then(signer => new Contract(FLASH_REGISTRY_ADDRESS, FLASH_REGISTRY_ABI, signer));
  }
  return Promise.resolve(new Contract(FLASH_REGISTRY_ADDRESS, FLASH_REGISTRY_ABI, provider));
}

export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,24}$/;