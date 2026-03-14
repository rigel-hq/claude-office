export function ZoneLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <text
      x={x}
      y={y}
      fill="#8b949e"
      fontSize={11}
      fontWeight="600"
      fontFamily="system-ui, sans-serif"
      letterSpacing="0.05em"
      opacity={0.7}
      style={{ textTransform: 'uppercase' }}
    >
      {label}
    </text>
  );
}
