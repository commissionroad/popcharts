import type { MarketSide } from "@/domain/markets/types";

export function PriceCurve({ path, side }: { path: number[]; side: MarketSide }) {
  const color = side === "yes" ? "var(--yes)" : "var(--no)";
  const points = path
    .map((price, index) => {
      const x = (index / Math.max(path.length - 1, 1)) * 300;
      const y = 100 - price;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      aria-label="Virtual LMSR implied probability path"
      className="h-[150px] w-full"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 300 100"
    >
      <defs>
        <linearGradient id={`curve-fill-${side}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#curve-fill-${side})`} points={`${points} 300,100 0,100`} />
      <polyline
        fill="none"
        points={points}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}
