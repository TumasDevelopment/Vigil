import { SERIES_COLORS } from "@/lib/palette";

const WIDTH = 120;
const HEIGHT = 28;
const PAD = 3;

// Una linea per ogni tratto continuo: i buchi (host muto) restano visibili come buchi.
export function Sparkline({ values, className = "" }: { values: (number | null)[]; className?: string }) {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return <svg className={`spark ${className}`} aria-hidden="true" />;

  const max = Math.max(...known, 0.001);
  const step = values.length > 1 ? WIDTH / (values.length - 1) : WIDTH;
  const y = (value: number) => HEIGHT - PAD - (value / max) * (HEIGHT - 2 * PAD);

  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else {
      current.push(`${(index * step).toFixed(1)},${y(value).toFixed(1)}`);
    }
  });
  if (current.length) segments.push(current.join(" "));

  return (
    <svg
      className={`spark ${className}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {segments.map((points) => (
        <polyline
          key={points}
          points={points}
          fill="none"
          stroke={SERIES_COLORS[0]}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
