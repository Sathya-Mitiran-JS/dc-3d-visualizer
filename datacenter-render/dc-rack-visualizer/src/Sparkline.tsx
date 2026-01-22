import { useMemo } from "react";

export function Sparkline({
  data,
  width = 200,
  height = 40,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  const points = useMemo(() => {
    if (data.length < 2) return "";

    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;

    return data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * (width - 2) + 1;
        const y = height - ((v - min) / span) * (height - 2) - 1;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <svg className="sparkline" width={width} height={height}>
        <text x="0" y={height / 2} fontSize="12" fill="currentColor" opacity="0.7">
          collecting…
        </text>
      </svg>
    );
  }

  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
