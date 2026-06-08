/**
 * Hardcoded protocol fees. Enforced BEFORE any bridge/trade execution.
 * Treasury addresses MUST be set in .env.
 */
export const DEPOSIT_FEE_USD = 0.05;
export const WITHDRAW_FEE_USD = 0.10;

export const CELO_FEE_TREASURY =
  (import.meta.env.VITE_CELO_FEE_TREASURY as string | undefined) ?? "";
export const ARB_FEE_TREASURY =
  (import.meta.env.VITE_ARB_FEE_TREASURY as string | undefined) ?? "";

export function assertCeloFeeTreasury() {
  if (!CELO_FEE_TREASURY) {
    throw new Error("VITE_CELO_FEE_TREASURY not set. Deposit fees cannot be collected.");
  }
}

export function assertArbFeeTreasury() {
  if (!ARB_FEE_TREASURY) {
    throw new Error("VITE_ARB_FEE_TREASURY not set. Withdraw fees cannot be collected.");
  }
}