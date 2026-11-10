import { BoxGeometry, ExtrudeGeometry, Shape } from "three";
import { describe, expect, it, vi } from "vitest";
import { merged } from "../src/geometry.ts";

const SIDE = 2;
const square = () => new Shape().moveTo(0, 0).lineTo(SIDE, 0).lineTo(SIDE, SIDE).lineTo(0, SIDE).lineTo(0, 0);

describe("Merging model geometry", () => {
  it("merges indexed and non-indexed parts into one geometry", () => {
    const box = new BoxGeometry();
    const plate = new ExtrudeGeometry(square(), { depth: 1, bevelEnabled: false });
    const vertices = box.toNonIndexed().getAttribute("position").count + plate.getAttribute("position").count;
    expect(merged([box, plate]).getAttribute("position").count).toBe(vertices);
  });

  it("keeps a merge of indexed parts indexed", () => {
    expect(merged([new BoxGeometry(), new BoxGeometry()]).index).not.toBeNull();
  });

  it("frees the parts once they are merged", () => {
    const box = new BoxGeometry();
    const freed = vi.fn();
    box.addEventListener("dispose", freed);
    merged([box, new BoxGeometry()]);
    expect(freed).toHaveBeenCalledOnce();
  });
});
