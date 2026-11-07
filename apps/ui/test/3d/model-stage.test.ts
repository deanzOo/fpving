import { BoxGeometry } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createModelStage, lookOf, phaseLevel, tokenColour } from "../../src/ui/model-stage.ts";
import type { Model, ModelStage, ScreenBox } from "../../src/ui/model-stage.ts";
import { applyTheme, Theme } from "../../src/ui/theme.ts";
import "../../src/styles.css";

const SIZE = 10;
const LIFT = 30;
const HOST_SIDE = 400;
const OFF_MODEL = 4;
const DRAG = 80;
const HALF = 0.5;
const LOW_VIEW = 0.1;
const HIGH_VIEW = 1.2;
const PIXEL_CHANNELS = 4;
const OPAQUE = 255;
const SOME_FRAMES = 2;
const PHASES = 3;
const POLL = { timeout: 20_000 };
const FINISH = { token: "model-steel", roughness: 0.5, metalness: 0.5 };

const model = (elevation = LOW_VIEW): Model<"low" | "high"> => ({
  elevation,
  phases: 2,
  polePairs: 2,
  pieces: [
    {
      id: "high",
      offset: LIFT,
      spins: true,
      meshes: [{ geometry: new BoxGeometry(SIZE, SIZE, SIZE).translate(0, SIZE, 0), finish: FINISH }],
    },
    {
      id: "low",
      offset: 0,
      spins: false,
      meshes: [{
        geometry: new BoxGeometry(SIZE, SIZE, SIZE),
        finish: FINISH,
        phase: { index: 1, token: "model-phase-b" },
      }],
    },
  ],
});

const stages: ModelStage<"low" | "high">[] = [];
const hosts: HTMLElement[] = [];

const mount = (handlers: {
  onHover?: (id: string | null) => void;
  onPick?: (id: string | null) => void;
  onFrame?: () => void;
  elevation?: number;
} = {}) => {
  const host = document.createElement("div");
  host.style.width = `${String(HOST_SIDE)}px`;
  host.style.height = `${String(HOST_SIDE)}px`;
  document.body.append(host);
  hosts.push(host);
  const stage = createModelStage({
    host,
    label: "A test model",
    model: model(handlers.elevation),
    onHover: handlers.onHover ?? vi.fn(),
    onPick: handlers.onPick ?? vi.fn(),
    onFrame: handlers.onFrame ?? vi.fn(),
  });
  if (stage === null) {
    throw new Error("the test browser has no WebGL");
  }
  stages.push(stage);
  const canvas = host.querySelector("canvas");
  if (canvas === null) {
    throw new Error("the stage drew no canvas");
  }
  return { host, stage, canvas };
};

const centre = (box: ScreenBox) => ({ x: box.left + box.width * HALF, y: box.top + box.height * HALF });

afterEach(() => {
  for (const stage of stages.splice(0)) {
    stage.dispose();
  }
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  applyTheme(Theme.System);
});

describe("Model stage", () => {
  it("draws a named canvas in its host", () => {
    const { canvas } = mount();
    expect(canvas.getAttribute("aria-label")).toBe("A test model");
    expect(canvas.getAttribute("role")).toBe("img");
  });

  it("gives up without a canvas when the browser has no WebGL", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const host = document.createElement("div");
    const stage = createModelStage({
      host, label: "x", model: model(), onHover: vi.fn(), onPick: vi.fn(), onFrame: vi.fn(),
    });
    expect(stage).toBeNull();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("removes its canvas when disposed", () => {
    const { host, stage } = mount();
    stage.dispose();
    stages.length = 0;
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("finds the piece under a point, and nothing beside the model", () => {
    const { host, stage } = mount();
    const { left, top } = host.getBoundingClientRect();
    const low = centre(stage.boxOf("low"));
    expect(stage.pieceAt(left + low.x, top + low.y)).toBe("low");
    expect(stage.pieceAt(left + OFF_MODEL, top + OFF_MODEL)).toBeNull();
  });

  it("lifts each piece by its offset as it comes apart, and brings it back", async () => {
    const { stage } = mount();
    const together = stage.boxOf("high").top;
    const lowTogether = stage.boxOf("low");
    stage.setExplode(1);
    await expect.poll(() => {
      const high = stage.boxOf("high");
      const low = stage.boxOf("low");
      return high.top + high.height < low.top;
    }, POLL).toBe(true);
    expect(stage.boxOf("low").height).toBeLessThanOrEqual(lowTogether.height);
    stage.setExplode(0);
    await expect.poll(() => Math.abs(stage.boxOf("high").top - together) < 1, POLL).toBe(true);
  });

  it("reports a click on a piece, and on empty space as nothing", async () => {
    const onPick = vi.fn();
    const { canvas, stage } = mount({ onPick });
    await userEvent.click(canvas, { position: centre(stage.boxOf("low")), timeout: POLL.timeout });
    await expect.poll(() => onPick.mock.lastCall, POLL).toEqual(["low"]);
    await userEvent.click(canvas, { position: { x: OFF_MODEL, y: OFF_MODEL }, timeout: POLL.timeout });
    await expect.poll(() => onPick.mock.lastCall, POLL).toEqual([null]);
  });

  it("treats a drag as turning the model, not as a click", async () => {
    const onPick = vi.fn();
    const { canvas, stage } = mount({ onPick });
    const before = stage.boxOf("low");
    const start = centre(before);
    await userEvent.dragAndDrop(canvas, canvas, {
      sourcePosition: start,
      targetPosition: { x: start.x + DRAG, y: start.y },
      timeout: POLL.timeout,
    });
    expect(onPick).not.toHaveBeenCalled();
    await expect.poll(() => stage.boxOf("low").width, POLL).not.toBe(before.width);
  });

  it("reports what the pointer is over, and nothing once it leaves", async () => {
    const onHover = vi.fn();
    const { canvas, stage } = mount({ onHover });
    await userEvent.hover(canvas, { position: centre(stage.boxOf("low")), timeout: POLL.timeout });
    await expect.poll(() => onHover.mock.lastCall, POLL).toEqual(["low"]);
    await userEvent.unhover(canvas);
    await expect.poll(() => onHover.mock.lastCall, POLL).toEqual([null]);
  });

  it("calls back after drawing a frame, so an overlay can follow the model", async () => {
    const onFrame = vi.fn();
    mount({ onFrame });
    await expect.poll(() => onFrame.mock.calls.length).toBeGreaterThan(0);
  });

  it("keeps drawing while powered and comes to rest when power is off", async () => {
    const onFrame = vi.fn();
    const { stage } = mount({ onFrame });
    await expect.poll(() => onFrame.mock.calls.length, POLL).toBeGreaterThan(0);
    const before = onFrame.mock.calls.length;
    stage.setPowered(true);
    await expect.poll(() => onFrame.mock.calls.length, POLL).toBeGreaterThan(before + SOME_FRAMES);
    stage.setPowered(false);
    await expect.poll(async () => {
      const seen = onFrame.mock.calls.length;
      await new Promise((resolve) => {
        setTimeout(resolve, HOST_SIDE);
      });
      return onFrame.mock.calls.length === seen;
    }, POLL).toBe(true);
  });

  it("really fades the other pieces when one is selected, so what is behind them shows through", async () => {
    const alpha = { value: -1 };
    const pixel = new Uint8Array(PIXEL_CHANNELS);
    const { canvas, stage } = mount({
      onFrame: () => {
        const context = canvas.getContext("webgl2");
        const { x, y } = centre(stage.boxOf("high"));
        context?.readPixels(x, canvas.height - y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        alpha.value = pixel[PIXEL_CHANNELS - 1] ?? -1;
      },
    });
    await expect.poll(() => alpha.value).toBe(OPAQUE);
    stage.setSelected("low");
    await expect.poll(() => alpha.value).toBeLessThan(OPAQUE * HALF);
    stage.setSelected(null);
    await expect.poll(() => alpha.value).toBe(OPAQUE);
  });

  it("redraws in the new colours when the theme changes", async () => {
    const onFrame = vi.fn();
    mount({ onFrame });
    await expect.poll(() => onFrame.mock.calls.length).toBeGreaterThan(0);
    const seen = onFrame.mock.calls.length;
    applyTheme(Theme.Dark);
    await expect.poll(() => onFrame.mock.calls.length).toBeGreaterThan(seen);
  });
});

describe("Model stage view", () => {
  it("looks at the model from its own elevation, so a flat part can be seen from above", () => {
    const heightFrom = (elevation: number): number => {
      const { height, width } = mount({ elevation }).stage.boxOf("low");
      return height / width;
    };
    expect(heightFrom(HIGH_VIEW)).toBeGreaterThan(heightFrom(LOW_VIEW));
  });
});

describe("Selected piece look", () => {
  it("leaves every piece solid and untinted with nothing selected or hovered", () => {
    expect(lookOf("a", null, null)).toEqual({ ghost: false, tinted: false });
  });

  it("ghosts the other pieces so the selected one stands alone", () => {
    expect(lookOf("a", "a", null)).toEqual({ ghost: false, tinted: false });
    expect(lookOf("b", "a", null)).toEqual({ ghost: true, tinted: false });
  });

  it("tints the hovered piece, unless it is the selected one", () => {
    expect(lookOf("a", null, "a")).toEqual({ ghost: false, tinted: true });
    expect(lookOf("a", "a", "a")).toEqual({ ghost: false, tinted: false });
  });
});

describe("Motor phase level", () => {
  const QUARTER = Math.PI * HALF;

  it("lights a phase only on the positive half of its wave", () => {
    expect(phaseLevel(QUARTER, 0, PHASES)).toBeCloseTo(1);
    expect(phaseLevel(-QUARTER, 0, PHASES)).toBe(0);
  });

  it("offsets each phase by its share of a full cycle", () => {
    expect(phaseLevel(QUARTER + (Math.PI + Math.PI) / PHASES, 1, PHASES)).toBeCloseTo(1);
  });
});

describe("Token colour", () => {
  it("reads a model colour from the theme now applied", () => {
    applyTheme(Theme.Dark);
    expect(tokenColour("model-phase-b").getHexString()).toBe("e3b341");
    applyTheme(Theme.Light);
    expect(tokenColour("model-phase-b").getHexString()).toBe("a8760f");
  });
});
