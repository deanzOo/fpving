import type { DotItemDotProps } from "recharts";

const DOT_RADIUS = 4;

/**
 * A line's dot renderer that draws a point only for a value with no value either side, so a lone price shows on a
 * line that leaves gaps; every other point draws nothing.
 *
 * @param values - The line's values, null where it has none.
 * @param look - The dot's class, fill and optional surface ring.
 * @returns The renderer.
 */
export const loneDot = (
  values: readonly unknown[],
  look: { readonly className: string; readonly fill: string; readonly ring?: { stroke: string; width: number } },
) => {
  const has = (index: number): boolean => (values[index] ?? null) !== null;
  return ({ cx, cy, index }: DotItemDotProps) =>
    has(index) && !has(index - 1) && !has(index + 1)
      ? (
          <circle
            key={index}
            className={look.className}
            cx={cx}
            cy={cy}
            r={DOT_RADIUS}
            fill={look.fill}
            stroke={look.ring?.stroke}
            strokeWidth={look.ring?.width}
          />
        )
      : null;
};
