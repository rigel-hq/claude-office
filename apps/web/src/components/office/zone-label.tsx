export function ZoneLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <text
      x={x}
      y={y}
      style={{ fill: 'var(--office-zone-label)', textTransform: 'uppercase' } as React.CSSProperties}
      fontSize={11}
      fontWeight="600"
      fontFamily="system-ui, sans-serif"
      letterSpacing="0.05em"
      opacity={0.7}
    >
      {label}
    </text>
  );
}
