export interface StatCardProps {
  /** What the number measures. */
  label: string;
  value: string;
  /** Colors the value. @default "neutral" */
  tone?: "positive" | "negative" | "neutral";
  onSelect?: (label: string) => void;
  className?: string;
}

export function StatCard({ label, value, tone = "neutral", className }: StatCardProps) {
  return (
    <div className={["fx-card", className].filter(Boolean).join(" ")} data-tone={tone}>
      <div>{label}</div>
      <strong>{value}</strong>
    </div>
  );
}
