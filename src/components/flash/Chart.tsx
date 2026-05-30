import { useMemo } from "react";

interface Candle { o: number; h: number; l: number; c: number; }

function genCandles(seed: number, count: number, base: number): Candle[] {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out: Candle[] = [];
  let price = base;
  for (let i = 0; i < count; i++) {
    const o = price;
    const change = (rand() - 0.5) * base * 0.015;
    const c = o + change;
    const h = Math.max(o, c) + rand() * base * 0.008;
    const l = Math.min(o, c) - rand() * base * 0.008;
    out.push({ o, h, l, c });
    price = c;
  }
  return out;
}

export function Chart({ price, symbol, entryPrice, liqPrice }: { price: number; symbol: string; entryPrice?: number; liqPrice?: number }) {
  const candles = useMemo(() => {
    const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return genCandles(seed, 40, price);
  }, [symbol, price]);

  const all = candles.flatMap(c => [c.h, c.l]);
  if (entryPrice) all.push(entryPrice);
  if (liqPrice) all.push(liqPrice);
  const min = Math.min(...all) * 0.998;
  const max = Math.max(...all) * 1.002;
  const w = 320, h = 200, pad = 8;
  const cw = (w - pad * 2) / candles.length;
  const y = (v: number) => pad + ((max - v) / (max - min)) * (h - pad * 2);

  return (
    <div className="box p-2 bg-white">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48">
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1={0} x2={w} y1={h * p} y2={h * p} stroke="#e5e5e5" strokeDasharray="2 3" />
        ))}
        {candles.map((c, i) => {
          const x = pad + i * cw + cw / 2;
          const up = c.c >= c.o;
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke="#0a0a0a" strokeWidth={1} />
              <rect
                x={x - cw * 0.35}
                y={y(Math.max(c.o, c.c))}
                width={cw * 0.7}
                height={Math.max(1, Math.abs(y(c.o) - y(c.c)))}
                fill={up ? "#fff" : "#0a0a0a"}
                stroke="#0a0a0a"
                strokeWidth={1}
              />
            </g>
          );
        })}
        {entryPrice && (
          <>
            <line x1={0} x2={w} y1={y(entryPrice)} y2={y(entryPrice)} stroke="oklch(0.65 0.22 145)" strokeWidth={1.2} strokeDasharray="4 3" />
            <rect x={w - 56} y={y(entryPrice) - 8} width={54} height={16} fill="oklch(0.65 0.22 145)" />
            <text x={w - 4} y={y(entryPrice) + 4} fontSize="10" textAnchor="end" fill="#fff" fontWeight="700">{entryPrice.toFixed(0)}</text>
          </>
        )}
        {liqPrice && (
          <>
            <line x1={0} x2={w} y1={y(liqPrice)} y2={y(liqPrice)} stroke="oklch(0.62 0.24 25)" strokeWidth={1.2} strokeDasharray="4 3" />
            <rect x={w - 56} y={y(liqPrice) - 8} width={54} height={16} fill="oklch(0.62 0.24 25)" />
            <text x={w - 4} y={y(liqPrice) + 4} fontSize="10" textAnchor="end" fill="#fff" fontWeight="700">{liqPrice.toFixed(0)}</text>
          </>
        )}
        {/* current price tag */}
        <rect x={w - 56} y={y(price) - 8} width={54} height={16} fill="#0a0a0a" />
        <text x={w - 4} y={y(price) + 4} fontSize="10" textAnchor="end" fill="#fff" fontWeight="700">{price.toFixed(2)}</text>
      </svg>
    </div>
  );
}