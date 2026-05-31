import { BrowserProvider, Contract, parseUnits, formatUnits, MaxUint256 } from "ethers";

/** Deployed FlashVault address on Celo. Set after deployment in .env */
export const FLASH_VAULT_ADDRESS =
  (import.meta.env.VITE_FLASH_VAULT_ADDRESS as string | undefined) ?? "";

/** cUSD (Mento) on Celo mainnet — 18 decimals. */
export const CUSD_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
export const CUSD_DECIMALS = 18;

export const FLASH_VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 amount) external",
  "function withdrawAll() external",
  "function balanceOf(address) external view returns (uint256)",
  "function totalDeposits() external view returns (uint256)",
  "function depositsPaused() external view returns (bool)",
  "event Deposited(address indexed user, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)",
];

export const ERC20_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
];

export function getProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet detected. Open Flash inside MiniPay.");
  }
  return new BrowserProvider(window.ethereum);
}

export async function getVaultBalance(wallet: string): Promise<string> {
  if (!FLASH_VAULT_ADDRESS) return "0";
  const provider = getProvider();
  const vault = new Contract(FLASH_VAULT_ADDRESS, FLASH_VAULT_ABI, provider);
  const raw: bigint = await vault.balanceOf(wallet);
  return formatUnits(raw, CUSD_DECIMALS);
}

export async function getWalletCusdBalance(wallet: string): Promise<string> {
  const provider = getProvider();
  const cusd = new Contract(CUSD_ADDRESS, ERC20_ABI, provider);
  const raw: bigint = await cusd.balanceOf(wallet);
  return formatUnits(raw, CUSD_DECIMALS);
}

/** Approve (if needed) + deposit cUSD into the vault. Returns final tx hash. */
export async function depositCusd(amountHuman: string): Promise<string> {
  if (!FLASH_VAULT_ADDRESS) throw new Error("Vault not deployed yet.");
  const provider = getProvider();
  const signer = await provider.getSigner();
  const from = await signer.getAddress();
  const amount = parseUnits(amountHuman, CUSD_DECIMALS);

  const cusd = new Contract(CUSD_ADDRESS, ERC20_ABI, signer);
  const allowance: bigint = await cusd.allowance(from, FLASH_VAULT_ADDRESS);
  if (allowance < amount) {
    const approveTx = await cusd.approve(FLASH_VAULT_ADDRESS, MaxUint256);
    await approveTx.wait();
  }

  const vault = new Contract(FLASH_VAULT_ADDRESS, FLASH_VAULT_ABI, signer);
  const tx = await vault.deposit(amount);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/** Withdraw cUSD from the vault. Pass "max" to withdraw everything. */
export async function withdrawCusd(amountHuman: string | "max"): Promise<string> {
  if (!FLASH_VAULT_ADDRESS) throw new Error("Vault not deployed yet.");
  const provider = getProvider();
  const signer = await provider.getSigner();
  const vault = new Contract(FLASH_VAULT_ADDRESS, FLASH_VAULT_ABI, signer);
  const tx =
    amountHuman === "max"
      ? await vault.withdrawAll()
      : await vault.withdraw(parseUnits(amountHuman, CUSD_DECIMALS));
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}