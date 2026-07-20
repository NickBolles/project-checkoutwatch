export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  if (values.length === 0) return <span>No response-time data yet</span>;
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(values.length - 1, 1)) * 180},${44 - (value / max) * 40}`,
    )
    .join(" ");
  return (
    <svg role="img" aria-label={label} width="180" height="48" viewBox="0 0 180 48">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
