interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'currentColor',
  fillOpacity = 0.15,
}: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const padding = 1;

  const points = data.map((v, i) => {
    const x = i * step;
    const y = padding + (height - 2 * padding) * (1 - v / max);
    return `${x},${y}`;
  });

  const linePath = `M${points.join('L')}`;
  const fillPath = `${linePath}L${width},${height}L0,${height}Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      class="overflow-visible"
    >
      <path d={fillPath} fill={color} opacity={fillOpacity} />
      <path d={linePath} fill="none" stroke={color} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
