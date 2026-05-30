import type { Candle } from "@/lib/marketData";

interface Props {
  candles: Candle[];
  price: number;
  entryPrice?: number;
  liqPrice?: number;
  isLive?: boolean;
}

function fmt(n: number) {
  if (n >= 1000) return n.toFixed(0);
  if (n >= 10) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(5);
}

export function Chart({ candles, price, entryPrice, liqPrice, isLive }: Props) {
  if (!candles.length) {
    return (
      <div className="box p-2 bg-white">
        <div className="h-48 grid place-items-center text-xs text-muted-foreground font-mono">LOADING MARKET DATA…</div>
      </div>
    );
  }

  const all: number[] = [];
  for (const c of candles) { all.push(c.h, c.l); }
  if (entryPrice) all.push(entryPrice);
  if (liqPrice) all.push(liqPrice);
  all.push(price);
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const pad = (rawMax - rawMin) * 0.08 || rawMax * 0.002;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const W = 320, H = 200, padL = 4, padR = 44, padY = 6;
  const innerW = W - padL - padR;
  const cw = innerW / candles.length;
  const y = (v: number) => padY + ((max - v) / (max - min)) * (H - padY * 2);

  return (
    <div className="box p-2 bg-white">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48" preserveAspectRatio="none">
        {/* gridlines */}
        {[0.2, 0.4, 0.6, 0.8].map(p => (
          <line key={p} x1={0} x2={W - padR} y1={H * p} y2={H * p} stroke="#ececec" strokeDasharray="2 3" />
        ))}
        {/* candles */}
        {candles.map((c, i) => {
          const x = padL + i * cw + cw / 2;
          const up = c.c >= c.o;
          const color = up ? "var(--profit)" : "var(--loss)";
          const bodyTop = y(Math.max(c.o, c.c));
          const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)));
          const bodyW = Math.max(1.5, cw * 0.7);
          return (
            <g key={c.t}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={`oklch(from ${color} l c h)`} strokeWidth={1} />
              <rect
                x={x - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={bodyH}
                fill={up ? "var(--profit)" : "var(--loss)"}
                stroke="#0a0a0a"
                strokeWidth={0.6}
              />
            </g>
          );
        })}
        {/* entry / liq lines */}
        {entryPrice !== undefined && (
          <g>
            <line x1={0} x2={W - padR} y1={y(entryPrice)} y2={y(entryPrice)} stroke="oklch(0.65 0.22 145)" strokeWidth={1.2} strokeDasharray="4 3" />
            <rect x={W - padR + 1} y={y(entryPrice) - 8} width={padR - 2} height={16} fill="oklch(0.65 0.22 145)" />
            <text x={W - 3} y={y(entryPrice) + 4} fontSize="9" textAnchor="end" fill="#fff" fontWeight="700">{fmt(entryPrice)}</text>
          </g>
        )}
        {liqPrice !== undefined && (
          <g>
            <line x1={0} x2={W - padR} y1={y(liqPrice)} y2={y(liqPrice)} stroke="oklch(0.62 0.24 25)" strokeWidth={1.2} strokeDasharray="4 3" />
            <rect x={W - padR + 1} y={y(liqPrice) - 8} width={padR - 2} height={16} fill="oklch(0.62 0.24 25)" />
            <text x={W - 3} y={y(liqPrice) + 4} fontSize="9" textAnchor="end" fill="#fff" fontWeight="700">{fmt(liqPrice)}</text>
          </g>
        )}
        {/* current price tag */}
        <line x1={0} x2={W - padR} y1={y(price)} y2={y(price)} stroke="#0a0a0a" strokeWidth={0.6} strokeDasharray="1 2" />
        <rect x={W - padR + 1} y={y(price) - 8} width={padR - 2} height={16} fill="#0a0a0a" />
        <text x={W - 3} y={y(price) + 4} fontSize="9" textAnchor="end" fill="#fff" fontWeight="700">{fmt(price)}</text>
        {/* live badge */}
        {isLive && (
          <g>
            <circle cx={8} cy={10} r={3} fill="var(--loss)">
              <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <text x={15} y={13} fontSize="8" fontWeight="700" fill="#0a0a0a">LIVE</text>
          </g>
        )}
      </svg>
    </div>
  );
}