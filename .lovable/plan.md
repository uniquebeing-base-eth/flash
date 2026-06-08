
# GMX + Squid Integration

Wires the three-leg flow (deposit → trade → withdraw) on top of the existing UI. No redesign. Squid for bridging, GMX SDK v2 for read/write, our app only routes funds and deducts fixed fees.

## 1. Config & secrets

Add to `.env`:
- `VITE_CELO_FEE_TREASURY` — receives $0.05 deposit fee (cUSD on Celo)
- `VITE_ARB_FEE_TREASURY` — receives $0.10 withdrawal fee (USDC on Arbitrum)
- `VITE_ARBITRUM_RPC_URL` — primary Arbitrum RPC (with one fallback hardcoded)

Hardcoded constants in `src/lib/fees.ts`:
- `DEPOSIT_FEE_USD = 0.05`
- `WITHDRAW_FEE_USD = 0.10`

Both fees displayed in UI before any signature.

## 2. Deposit (Celo → Arbitrum USDC)

File: `src/lib/squidBridge.ts` (extend existing).

State machine persisted in `localStorage` keyed by `depositId` (uuid):
`INITIATED → FEE_PAID → BRIDGING → COMPLETED | FAILED`

Flow in `bridgeDeposit(amountCusdHuman)`:
1. Compute `feeCusd` = $0.05 worth of cUSD (1:1 assumption, cUSD is USD-pegged).
2. `netAmount = amount - feeCusd`. Reject if `netAmount <= 0`.
3. Send `feeCusd` cUSD transfer → `VITE_CELO_FEE_TREASURY`. Mark `FEE_PAID`.
4. Call Squid `v2/route` with `netAmount`, `toAddress = user's Arbitrum address` (same wallet).
5. Approve cUSD to Squid target if needed, submit tx. Mark `BRIDGING`, store `srcTxHash`.
6. Poll `https://api.squidrouter.com/v2/status?transactionId=<hash>` every 8s up to ~10 min. On `success` → `COMPLETED`. On error → retry up to 3x then `FAILED`.

Recovery: expose `retryDeposit(depositId)` that resumes from last persisted step.

UI: `AccountDrawer` shows live status badge + fee line ("Network fee: $0.05") before signing.

## 3. Trading (GMX v2)

Install `@gmx-io/sdk` and use `GmxApiSdk` (HTTP-backed, Worker-safe — no native deps).

File: `src/lib/gmx.ts`:
- `getMarkets()` → `apiSdk.fetchMarkets()` cached 60s
- `getPositions(address)` → `apiSdk.fetchPositionsInfo({ address, includeRelatedOrders: true })` cached 5s
- `openMarketOrder({ marketSymbol, isLong, sizeUsd, leverage, collateralUsdc })` → prepare via SDK, sign with browser wallet on Arbitrum, submit.
- `closePosition(positionKey)` → same pattern.

App is **router only**: no fee injection, no PnL override. PnL/liq prices come from `fetchPositionsInfo`.

Local mirror in `localStorage` for UX continuity:
`{ user, positionKey, marketSymbol, sizeUsd, collateralUsd, entryPrice, status: OPEN|CLOSED }`.
Reconciled on every poll from GMX as source of truth.

UI wiring in `src/routes/index.tsx`:
- Replace the current mock `setPosition` with `openMarketOrder` call.
- Show pending state during keeper execution (~10-30s).
- Poll positions every 5s while a position is open; update entry/PnL/liq from GMX response.

Chain switch: if `wallet.chainId !== 42161`, prompt `wallet_switchEthereumChain` before order.

## 4. Withdrawal (Arbitrum → Celo cUSD)

File: `src/lib/withdraw.ts`.

State machine:
`INITIATED → POSITION_CLOSING → BRIDGING_BACK → COMPLETED | FAILED`

Flow:
1. Check `getPositions(user)`. If any `OPEN` → block with "Close all positions first".
2. Send $0.10 USDC → `VITE_ARB_FEE_TREASURY`.
3. `netAmount = usdcBalance - 0.10`. Show bridge cost estimate from Squid quote.
4. Squid `v2/route` Arbitrum USDC → Celo cUSD, `toAddress = MiniPay address`.
5. Approve + submit, poll status same as deposit.
6. On `success` → `COMPLETED`.

UI: new Withdraw section in `AccountDrawer` with amount input, fee breakdown, status.

## 5. Error handling

- Squid: 3 retries with exponential backoff (1s, 3s, 8s). On final failure, store `FAILED` with last error and surface "Retry" button calling `retryDeposit` / `retryWithdraw`.
- GMX: if order submission reverts, do not bridge anything; show toast with revert reason.
- RPC: wrap Arbitrum reads in `withRpcFallback([primary, 'https://arb1.arbitrum.io/rpc'])`.

## 6. Logging

`src/lib/logger.ts` — single `logEvent({ flow, step, status, txHash, error })` that writes to `console.info` and a capped (200-entry) ring buffer in `localStorage` viewable via a hidden debug panel.

Logged events: `deposit.initiated`, `deposit.fee_paid`, `deposit.bridging`, `deposit.completed/failed`, `trade.submitted`, `trade.opened/closed/failed`, `withdraw.*`.

## Technical details

- Files touched: `.env`, `src/lib/squidBridge.ts`, `src/lib/fees.ts` (new), `src/lib/gmx.ts` (new), `src/lib/withdraw.ts` (new), `src/lib/logger.ts` (new), `src/lib/rpc.ts` (new), `src/components/flash/AccountDrawer.tsx`, `src/routes/index.tsx`.
- New deps: `@gmx-io/sdk` (HTTP client, edge-safe), `uuid`.
- No backend server functions needed — all signing is wallet-side, all reads are public HTTP. Keeps the Cloudflare bundle clean.
- MiniPay constraint: single-signature flows. Each step (fee transfer, approval, bridge tx) is a separate signature; we batch where possible (max approval once).

## Out of scope (confirm)

- No custodial vault; user's own Arbitrum address holds USDC and GMX position.
- No GraphQL history view yet (can add later as a `History` tab).
- Delegated/gasless trading via Gelato relay — not in this pass.
