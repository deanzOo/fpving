/** How many drawn segments each line in `container` has: a gap splits a line into one more. */
export const curveSegments = (container: Element): number[] => [...container.querySelectorAll(".recharts-line-curve")]
  .map((curve) => (curve.getAttribute("d") ?? "").split("M").length - 1);
