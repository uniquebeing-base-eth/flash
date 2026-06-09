import { BrowserProvider, Contract, Interface, ZeroAddress, parseUnits, MaxUint256 } from "ethers";
import { logEvent } from "./logger";

/**
 * Minimal direct ExchangeRouter wiring for GMX v2 (Arbitrum).
 * Builds calldata for MarketIncrease / MarketDecrease / TP / SL via multicall.
 *
 * NOTE: GMX prices use 30-decimal fixed point (USD * 1e30 / 10^tokenDecimals).
 */

export const EXCHANGE_ROUTER = "0x900173A66dbD345006C51fA35fA3aB760FcD843b";
export const ORDER_VAULT = "0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5";
export const ROUTER = "0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6";
export const WNT = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // WETH on Arbitrum
export const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const REFERRAL_STORAGE = "0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d";

export enum OrderType {
  MarketSwap = 0,
  LimitSwap = 1,
  MarketIncrease = 2,
  LimitIncrease = 3,
  MarketDecrease = 4,
  LimitDecrease = 5,
  StopLossDecrease = 6,
  Liquidation = 7,
}

export enum DecreasePositionSwapType {
  NoSwap = 0,
  SwapPnlTokenToCollateralToken = 1,
  SwapCollateralTokenToPnlToken = 2,
}

// CreateOrderParams tuple as ABI
const EXCHANGE_ROUTER_ABI = [
  "function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)",
  "function sendWnt(address receiver, uint256 amount) external payable",
  "function sendTokens(address token, address receiver, uint256 amount) external payable",
  `function createOrder(
    tuple(
      tuple(address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses,
      tuple(uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount, uint256 validFromTime) numbers,
      uint8 orderType,
      uint8 decreasePositionSwapType,
      bool isLong,
      bool shouldUnwrapNativeToken,
      bool autoCancel,
      bytes32 referralCode
    ) params
  ) external payable returns (bytes32)`,
];

const erc20Abi = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const iface = new Interface(EXCHANGE_ROUTER_ABI);

function encode(method: string, args: unknown[]): string {
  return iface.encodeFunctionData(method, args);
}

export interface OpenOrderInput {
  marketAddress: string;
  indexTokenDecimals: number;
  collateralAmountUsdc: number;        // human USDC (6 decimals)
  sizeDeltaUsd: number;                 // human USD
  isLong: boolean;
  markPrice: number;                    // human USD per index unit
  slippageBps?: number;                 // default 50 = 0.5%
  takeProfitPrice?: number;             // human USD
  stopLossPrice?: number;               // human USD
}

const EXEC_FEE_WEI = parseUnits("0.0015", 18); // ~0.0015 ETH keeper fee

function priceToContract(humanPrice: number, indexTokenDecimals: number): bigint {
  // GMX expects price * 10^(30 - tokenDecimals)
  const decimals = 30 - indexTokenDecimals;
  // use string to avoid float blowup
  const [int, frac = ""] = humanPrice.toFixed(Math.min(decimals, 18)).split(".");
  const padded = (int + frac.padEnd(decimals, "0")).slice(0, int.length + decimals);
  return BigInt(padded);
}

function withSlippage(price: bigint, bps: number, isLong: boolean): bigint {
  // long pays more (acceptablePrice > mark), short accepts less
  const mult = BigInt(10_000 + (isLong ? bps : -bps));
  return (price * mult) / 10_000n;
}

async function ensureArbitrum(provider: BrowserProvider) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 42161) {
    await window.ethereum!.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xa4b1" }],
    });
  }
}

async function ensureUsdcAllowance(signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>, owner: string, amount: bigint) {
  const usdc = new Contract(USDC_ARB, erc20Abi, signer);
  const cur: bigint = await usdc.allowance(owner, ROUTER);
  if (cur < amount) {
    const tx = await usdc.approve(ROUTER, MaxUint256);
    await tx.wait();
  }
}

function buildCreateOrderCalldata(args: {
  account: string;
  marketAddress: string;
  collateralToken: string;
  sizeDeltaUsd: bigint;
  initialCollateralDeltaAmount: bigint;
  acceptablePrice: bigint;
  triggerPrice: bigint;
  executionFee: bigint;
  orderType: OrderType;
  isLong: boolean;
  decreaseSwap?: DecreasePositionSwapType;
}) {
  const params = {
    addresses: {
      receiver: args.account,
      cancellationReceiver: ZeroAddress,
      callbackContract: ZeroAddress,
      uiFeeReceiver: ZeroAddress,
      market: args.marketAddress,
      initialCollateralToken: args.collateralToken,
      swapPath: [] as string[],
    },
    numbers: {
      sizeDeltaUsd: args.sizeDeltaUsd,
      initialCollateralDeltaAmount: args.initialCollateralDeltaAmount,
      triggerPrice: args.triggerPrice,
      acceptablePrice: args.acceptablePrice,
      executionFee: args.executionFee,
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n,
    },
    orderType: args.orderType,
    decreasePositionSwapType: args.decreaseSwap ?? DecreasePositionSwapType.NoSwap,
    isLong: args.isLong,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  return encode("createOrder", [params]);
}

export async function openMarketPosition(input: OpenOrderInput): Promise<string> {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No wallet detected.");
  const provider = new BrowserProvider(window.ethereum);
  await ensureArbitrum(provider);
  const signer = await provider.getSigner();
  const account = await signer.getAddress();

  const slippageBps = input.slippageBps ?? 50;
  const collateralAmount = parseUnits(input.collateralAmountUsdc.toFixed(6), 6);
  const sizeDeltaUsdC = priceToContract(input.sizeDeltaUsd, 0); // sizeDelta uses 1e30
  const markPriceC = priceToContract(input.markPrice, input.indexTokenDecimals);
  const acceptable = withSlippage(markPriceC, slippageBps, input.isLong);

  await ensureUsdcAllowance(signer, account, collateralAmount);

  const calls: string[] = [];
  // wrap ETH for keeper exec fee
  calls.push(encode("sendWnt", [ORDER_VAULT, EXEC_FEE_WEI]));
  // send USDC collateral to OrderVault
  calls.push(encode("sendTokens", [USDC_ARB, ORDER_VAULT, collateralAmount]));
  // create the market-increase order
  calls.push(
    buildCreateOrderCalldata({
      account,
      marketAddress: input.marketAddress,
      collateralToken: USDC_ARB,
      sizeDeltaUsd: sizeDeltaUsdC,
      initialCollateralDeltaAmount: 0n,
      acceptablePrice: acceptable,
      triggerPrice: 0n,
      executionFee: EXEC_FEE_WEI,
      orderType: OrderType.MarketIncrease,
      isLong: input.isLong,
    }),
  );

  // Optional TP
  if (input.takeProfitPrice && input.takeProfitPrice > 0) {
    const tpC = priceToContract(input.takeProfitPrice, input.indexTokenDecimals);
    calls.push(encode("sendWnt", [ORDER_VAULT, EXEC_FEE_WEI]));
    calls.push(
      buildCreateOrderCalldata({
        account,
        marketAddress: input.marketAddress,
        collateralToken: USDC_ARB,
        sizeDeltaUsd: sizeDeltaUsdC,
        initialCollateralDeltaAmount: 0n,
        acceptablePrice: withSlippage(tpC, slippageBps, !input.isLong),
        triggerPrice: tpC,
        executionFee: EXEC_FEE_WEI,
        orderType: OrderType.LimitDecrease,
        isLong: input.isLong,
      }),
    );
  }

  // Optional SL
  if (input.stopLossPrice && input.stopLossPrice > 0) {
    const slC = priceToContract(input.stopLossPrice, input.indexTokenDecimals);
    calls.push(encode("sendWnt", [ORDER_VAULT, EXEC_FEE_WEI]));
    calls.push(
      buildCreateOrderCalldata({
        account,
        marketAddress: input.marketAddress,
        collateralToken: USDC_ARB,
        sizeDeltaUsd: sizeDeltaUsdC,
        initialCollateralDeltaAmount: 0n,
        acceptablePrice: withSlippage(slC, slippageBps, !input.isLong),
        triggerPrice: slC,
        executionFee: EXEC_FEE_WEI,
        orderType: OrderType.StopLossDecrease,
        isLong: input.isLong,
      }),
    );
  }

  const totalEth = EXEC_FEE_WEI * BigInt(1 + (input.takeProfitPrice ? 1 : 0) + (input.stopLossPrice ? 1 : 0));
  const router = new Contract(EXCHANGE_ROUTER, EXCHANGE_ROUTER_ABI, signer);
  logEvent({ flow: "trade", step: "submitted", status: "info", meta: { calls: calls.length, totalEth: totalEth.toString() } });
  const tx = await router.multicall(calls, { value: totalEth });
  await tx.wait();
  logEvent({ flow: "trade", step: "opened", status: "ok", txHash: tx.hash });
  return tx.hash;
}

export interface CloseInput {
  marketAddress: string;
  indexTokenDecimals: number;
  sizeDeltaUsd: number;
  collateralDeltaUsdc?: number;
  isLong: boolean;
  markPrice: number;
  slippageBps?: number;
}

export async function closeMarketPosition(input: CloseInput): Promise<string> {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No wallet detected.");
  const provider = new BrowserProvider(window.ethereum);
  await ensureArbitrum(provider);
  const signer = await provider.getSigner();
  const account = await signer.getAddress();

  const slippageBps = input.slippageBps ?? 50;
  const sizeDeltaUsdC = priceToContract(input.sizeDeltaUsd, 0);
  const markPriceC = priceToContract(input.markPrice, input.indexTokenDecimals);
  // For decrease: long sells (accept lower), short buys (accept higher)
  const acceptable = withSlippage(markPriceC, slippageBps, !input.isLong);

  const collateralDelta = input.collateralDeltaUsdc
    ? parseUnits(input.collateralDeltaUsdc.toFixed(6), 6)
    : 0n;

  const calls: string[] = [
    encode("sendWnt", [ORDER_VAULT, EXEC_FEE_WEI]),
    buildCreateOrderCalldata({
      account,
      marketAddress: input.marketAddress,
      collateralToken: USDC_ARB,
      sizeDeltaUsd: sizeDeltaUsdC,
      initialCollateralDeltaAmount: collateralDelta,
      acceptablePrice: acceptable,
      triggerPrice: 0n,
      executionFee: EXEC_FEE_WEI,
      orderType: OrderType.MarketDecrease,
      isLong: input.isLong,
      decreaseSwap: DecreasePositionSwapType.SwapPnlTokenToCollateralToken,
    }),
  ];

  const router = new Contract(EXCHANGE_ROUTER, EXCHANGE_ROUTER_ABI, signer);
  const tx = await router.multicall(calls, { value: EXEC_FEE_WEI });
  await tx.wait();
  logEvent({ flow: "trade", step: "closed", status: "ok", txHash: tx.hash });
  return tx.hash;
}

// Re-export referral storage in case UI wants to surface it
export { REFERRAL_STORAGE as GMX_REFERRAL_STORAGE };