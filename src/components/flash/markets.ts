export interface Market {
  symbol: string;
  name: string;
  category: "Crypto" | "Forex" | "Commodities";
  price: number;
  change24h: number;
  icon: string;
}

export const MARKETS: Market[] = [
  { symbol: "BTC/USD", name: "Bitcoin", category: "Crypto", price: 67432.18, change24h: 2.31, icon: "₿" },
  { symbol: "ETH/USD", name: "Ethereum", category: "Crypto", price: 2049.23, change24h: -1.3, icon: "Ξ" },
  { symbol: "SOL/USD", name: "Solana", category: "Crypto", price: 142.55, change24h: 4.12, icon: "◎" },
  { symbol: "DOGE/USD", name: "Dogecoin", category: "Crypto", price: 0.1342, change24h: -2.4, icon: "Ð" },
  { symbol: "EUR/USD", name: "Euro", category: "Forex", price: 1.0823, change24h: 0.12, icon: "€" },
  { symbol: "GBP/USD", name: "Pound", category: "Forex", price: 1.2654, change24h: -0.21, icon: "£" },
  { symbol: "USD/JPY", name: "Yen", category: "Forex", price: 156.43, change24h: 0.34, icon: "¥" },
  { symbol: "AUD/USD", name: "Aussie", category: "Forex", price: 0.6612, change24h: 0.08, icon: "A$" },
  { symbol: "XAU/USD", name: "Gold", category: "Commodities", price: 2342.55, change24h: -1.1, icon: "Au" },
  { symbol: "XAG/USD", name: "Silver", category: "Commodities", price: 29.83, change24h: -0.6, icon: "Ag" },
];