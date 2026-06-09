
# Make Flash Trading Real

Wire live GMX v2 reads, real order execution (market + TP/SL), all GMX markets, and verify the Squid bridge end-to-end. Strip all demo/mock data.

## 1. GMX market discovery (all tradable markets)

`src/lib/gmx.ts` — fetch the full market list from GMX subsquid + tickers and expose to UI.

- `fetchGmxMarkets()` → calls `https://arbitrum-api.gmxinfra.io/markets` + `/tokens` + `/prices/tickers` (public, edge-safe HTTP).
- Returns: `{ marketAddress, indexToken, longToken, shortToken, symbol, name, maxLeverage, indexPrice, change24h }`.
- Cached 30s in module memory.
- Surface synthetic markets too (forex/commodities perps on GMX where available).

`src/components/flash/markets.ts` — rebuild `MARKETS` dynamically from GMX response (replace hard-coded list). Chart symbol mapping: GMX `indexToken.symbol` → Binance `<SYM>USDT` when crypto, else use GMX oracle price feed directly via `/prices/tickers` polled every 3s. **Removes the hard-coded MARKETS demo prices.**

## 2. Live position sync via subsquid + polling

`src/lib/gmxPositions.ts` (new):

- `fetchPositions(account)` — queries the GMX subsquid GraphQL endpoint:
  ```
  query { positions(where: { account: $a, sizeInUsd_gt: 0 }) {
    id key market isLong sizeInUsd collateralAmount entryPrice
  } }
  ```
- Joins with live tickers to compute markPrice → pnl, pnl%, liquidation price using GMX's formula:
  `liq = entryPrice ± entryPrice * (collateralUsd - maintenanceMargin) / sizeInUsd`.
- `useLivePositions(account)` React hook — polls every 4s via `setInterval`, merges with order events from subsquid (`orders` table filtered by `account` + `status`).
- Exports `OpenPosition` with `markPrice`, `pnl`, `pnlPercentage`, `liquidationPrice`, `triggerOrders[]` (TP/SL).

This becomes the **source of truth** — `src/routes/index.tsx` no longer keeps `position` in `useState`; it reads from the hook.

## 3. Order execution: market + TP/SL

`src/lib/gmxOrders.ts` (new) — direct ExchangeRouter calls (skips the SDK's heavier wallet client requirement; viem-free path).

Approach: GMX v2 routes all orders through `ExchangeRouter.multicall([...])`. We build calldata directly:

- `createIncreaseOrder({ marketAddress, collateralToken, isLong, sizeDeltaUsd, collateralAmount, acceptablePrice, slippageBps, executionFee, triggerPrice?, orderType })`
- For market order: `orderType = MarketIncrease (2)`.
- For TP: `orderType = LimitDecrease (4)` with `triggerPrice` above entry (long) / below entry (short).
- For SL: `orderType = StopLossDecrease (6)`.

Submission flow per trade:
1. Approve USDC → `OrderVault` (max once).
2. `sendWnt(executionFee)` — wraps ETH for keeper.
3. `sendTokens(USDC, OrderVault, collateral)`.
4. `createOrder(params)` for the market increase.
5. If TP/SL set: append `createOrder` calls for `LimitDecrease` + `StopLossDecrease` in the same multicall.

ABI + addresses pulled from `https://arbitrum-api.gmxinfra.io/markets` config. We hardcode the ExchangeRouter address (`0x900173A66dbD345006C51fA35fA3aB760FcD843b`) and OrderVault (`0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5`).

`closePosition({ positionKey, sizeDeltaUsd, isLong })` — same pattern with `MarketDecrease (4)`.

UI wiring in `src/routes/index.tsx`:
- LONG/SHORT buttons → `createIncreaseOrder(...)` with current size/leverage + optional TP/SL inputs.
- Add TP/SL number inputs in the trade panel (replacing the current dead toggle).
- "CLOSE POSITION" → `closePosition` with full size.
- Pending state during keeper execution (10–30s); position hook reconciles.

## 4. Verify Squid bridging

- Fix `pollSquidStatus` endpoint: the v2 path is `https://apiplus.squidrouter.com/v2/status?transactionId=<hash>&fromChainId=...&toChainId=...`. Update both deposit + withdraw.
- Add `requestId` capture from route response (Squid uses `requestId` not `transactionId` for new flows).
- Replace Axelarscan link with Squid's tracker: `https://axelarscan.io/gmp/<txHash>` only if Axelar route; otherwise `https://app.squidrouter.com/transaction/<hash>`.
- Test path: quoteDeposit → see fee + ETA → submit → status badge transitions FEE_PAID → BRIDGING → COMPLETED.
- Add chain switch before deposit signing (wallet must be on Celo 42220).

## 5. Remove all demo data

- `src/components/flash/markets.ts`: delete hard-coded list (dynamic from GMX).
- `src/routes/index.tsx`: remove `basePrice` fallback, "I'M FEELING LUCKY" random button.
- `AccountDrawer` ProfileTab: replace hardcoded stats (23 trades, 61%, $124.22…) with reads from `localStorage`-stored real trade history + `Streak` random data → empty state until real trades exist.
- `HistoryDrawer`, `LeaderboardDrawer`: read from real sources (GMX subsquid `trades` for history; leaderboard becomes "Coming soon" until we have a backend).
- `src/lib/marketData.ts`: drop `basePrice` arg, remove all `fallbackSeed` paths; if GMX/Binance fail, show "—" not synthetic numbers.

## 6. Files

**New:** `src/lib/gmxOrders.ts`, `src/lib/gmxPositions.ts`, `src/lib/gmxMarkets.ts`, `src/hooks/useLivePositions.ts`.

**Edited:** `src/lib/gmx.ts`, `src/lib/squidBridge.ts`, `src/lib/withdrawBridge.ts`, `src/lib/marketData.ts`, `src/components/flash/markets.ts`, `src/components/flash/AccountDrawer.tsx`, `src/components/flash/HistoryDrawer.tsx`, `src/components/flash/LeaderboardDrawer.tsx`, `src/routes/index.tsx`.

**Deps:** keep `@gmx-io/sdk` (for read fallbacks only); add no new runtime deps. All order calldata built with `ethers.Interface`.

## 7. Out of scope this pass

- Gasless/relayed orders (Gelato) — user pays ARB gas, signs each tx in MiniPay.
- On-chain trade history archive in our DB — we read from GMX subsquid directly.
- Cross-margin / portfolio mode — isolated only.

## Risks / unknowns

- **GMX ExchangeRouter ABI**: I'll inline only the methods we call (`multicall`, `sendWnt`, `sendTokens`, `createOrder`). If oracle params (acceptablePrice resolution from tickers) drift, the order may revert with `OrderPriceMismatch`; we surface the revert reason and bump slippage to 0.5% default.
- **Position liq price** is approximate without GMX's funding fee state. We label it "Est. Liq." in the UI to be honest.
- **MiniPay multi-sig**: each step = a separate signature prompt. We batch approve+order via multicall where possible.

