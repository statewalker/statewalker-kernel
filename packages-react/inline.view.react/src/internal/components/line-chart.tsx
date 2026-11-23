import type { ReactElement } from "react";

interface LineChartProps {
  /** Series of numeric values (y-axis); index serves as x-axis. */
  values: number[];
  /** Optional axis labels — shown next to the first/last point. */
  startLabel?: string;
  endLabel?: string;
  /** Display height in pixels; width is fluid. Defaults to 80. */
  height?: number;
}

function isLineChartProps(value: unknown): value is LineChartProps {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.values) &&
    v.values.length > 0 &&
    v.values.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Minimal SVG line chart — no external dependency. Renders a fluid
 * polyline scaled to its parent's width and the configured height.
 * Sufficient for the inline-content "worked example" in Wave 6;
 * richer charts can replace this entry by registering under the
 * same id.
 */
export function LineChart({ props }: { props: unknown }): ReactElement {
  if (!isLineChartProps(props)) {
    return <InlineError message="LineChart: invalid props" />;
  }
  const { values, startLabel, endLabel } = props;
  const height = props.height ?? 80;
  const width = 200;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values
    .map((y, i) => `${i * stepX},${height - ((y - min) / range) * height}`)
    .join(" ");

  return (
    <div className="inline-flex flex-col">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-20 w-full max-w-xs"
        role="img"
        aria-label={`Line chart with ${values.length} points`}
      >
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      </svg>
      {startLabel || endLabel ? (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{startLabel ?? ""}</span>
          <span>{endLabel ?? ""}</span>
        </div>
      ) : null}
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
