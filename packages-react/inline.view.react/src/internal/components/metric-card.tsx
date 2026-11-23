import type { ReactElement } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  /** "positive" turns delta green, "negative" red, omit for neutral. */
  trend?: "positive" | "negative";
}

function isMetricCardProps(value: unknown): value is MetricCardProps {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.label === "string" && (typeof v.value === "string" || typeof v.value === "number")
  );
}

export function MetricCard({ props }: { props: unknown }): ReactElement {
  if (!isMetricCardProps(props)) {
    return <InlineError message="MetricCard: invalid props" />;
  }
  const { label, value, delta, trend } = props;
  const trendClass =
    trend === "positive"
      ? "text-emerald-600"
      : trend === "negative"
        ? "text-red-600"
        : "text-muted-foreground";
  return (
    <div className="inline-flex flex-col rounded-md border border-border bg-card px-4 py-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {delta ? <span className={`text-xs font-medium ${trendClass}`}>{delta}</span> : null}
    </div>
  );
}

function InlineError({ message }: { message: string }): ReactElement {
  return (
    <span className="rounded-sm bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive">
      {message}
    </span>
  );
}
