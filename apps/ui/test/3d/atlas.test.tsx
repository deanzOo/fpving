import { apiRoutes } from "@fpving/app/api-routes";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { BOLT_PIECE_GUIDES, BOLT_SIZES, BOLTS_GUIDE } from "../../src/bolts-guide.ts";
import { BoltPiece } from "../../src/bolts-model.ts";
import { ESC_GUIDE, ESC_PIECE_GUIDES } from "../../src/esc-guide.ts";
import { EscPiece } from "../../src/esc-model.ts";
import { FC_GUIDE, FC_PIECE_GUIDES } from "../../src/fc-guide.ts";
import { FcPiece } from "../../src/fc-model.ts";
import { FRAME_GUIDE, FRAME_PIECE_GUIDES } from "../../src/frame-guide.ts";
import { ANALOG_GUIDE, ANALOG_PIECE_GUIDES, DIGITAL_GUIDE, DIGITAL_PIECE_GUIDES } from "../../src/video-guide.ts";
import { AnalogPiece, DigitalPiece } from "../../src/video-model.ts";
import { FramePiece } from "../../src/frame-model.ts";
import { MOTOR_GUIDE, MOTOR_PIECE_GUIDES } from "../../src/motor-guide.ts";
import { buildMotor, MAGNET_POLES, MotorPiece, PHASES, STATOR_SLOTS } from "../../src/motor-model.ts";
import { fakeApi, reply, wire } from "../support/fake-api.ts";
import { renderApp } from "../support/render-app.tsx";
import { hasBrackets } from "../support/style.ts";
import "../../src/styles.css";

const ATLAS = "/atlas";
const UNREAD = "?unread=true";
const PAIR = 2;
const POLL = { timeout: 20_000 };
const PHONE = { width: 375, height: 812 } as const;

const scripted = () => {
  const api = fakeApi();
  api.on(apiRoutes.listAlerts, reply(wire.alerts, []), UNREAD);
  return api;
};

const open = async () => {
  const screen = await renderApp(scripted().client, ATLAS);
  await expect.element(screen.getByRole("heading", { level: 1, name: "Atlas" }), POLL).toBeVisible();
  await expect.element(screen.getByRole("img", { name: /brushless motor/u }), POLL).toBeVisible();
  return screen;
};

describe("Motor model", () => {
  const motor = buildMotor();

  it("is seen from a low angle, side on", () => {
    expect(motor.elevation).toBeLessThan(Math.PI / PHASES / PAIR);
  });

  it("has a 2207's 12 slots, 14 magnets and 3 phases", () => {
    expect(STATOR_SLOTS % PHASES).toBe(0);
    expect(MAGNET_POLES % PAIR).toBe(0);
    expect(motor.phases).toBe(PHASES);
    expect(motor.polePairs).toBe(MAGNET_POLES / PAIR);
  });

  it("builds every piece the guide describes, and no others", () => {
    expect(motor.pieces.map(({ id }) => id)).toEqual(Object.values(MotorPiece));
    expect(Object.keys(MOTOR_PIECE_GUIDES).toSorted()).toEqual(Object.values(MotorPiece).toSorted());
  });

  it("gives each set of coils its own phase, so they can light in turn", () => {
    const windings = motor.pieces.find(({ id }) => id === MotorPiece.Windings);
    expect(windings?.meshes.map(({ phase }) => phase?.index)).toEqual(Array.from({ length: PHASES }, (_none, i) => i));
  });

  it("spins the rotor and leaves the rest still", () => {
    const spinning = motor.pieces.filter(({ spins }) => spins).map(({ id }) => id);
    expect(spinning).toEqual([MotorPiece.Nut, MotorPiece.Shaft, MotorPiece.Bell, MotorPiece.Magnets, MotorPiece.Clip]);
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of motor.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});

describe("Atlas", () => {
  it("is reachable from the main navigation", async () => {
    const api = fakeApi();
    api.on(apiRoutes.listAlerts, reply(wire.alerts, []), UNREAD);
    api.on(apiRoutes.listProducts, reply(wire.watchlist, []));
    const screen = await renderApp(api.client);
    await screen.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Atlas" }).click(POLL);
    await expect.element(screen.getByRole("heading", { level: 1, name: "Atlas" }), POLL).toBeVisible();
  });

  it("describes the whole motor until a piece is picked", async () => {
    const screen = await open();
    await expect.element(screen.getByRole("heading", { level: 2, name: MOTOR_GUIDE.name })).toBeVisible();
    await expect.element(screen.getByText(MOTOR_GUIDE.how)).toBeVisible();
  });

  it("lists every piece, so all of it is reachable without the 3D view", async () => {
    const screen = await open();
    for (const { name } of Object.values(MOTOR_PIECE_GUIDES)) {
      await expect.element(screen.getByRole("button", { name, exact: true })).toBeVisible();
    }
  });

  it("explains a piece picked from the list and marks it current and in brackets, then lets it go", async () => {
    const screen = await open();
    const { name, fails } = MOTOR_PIECE_GUIDES[MotorPiece.Stator];
    const item = screen.getByRole("button", { name, exact: true });
    await item.click(POLL);
    await expect.element(screen.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect.element(screen.getByText(fails)).toBeVisible();
    await expect.element(item).toHaveAttribute("aria-current", "true");
    expect(hasBrackets(screen.getByTestId("reticle"))).toBe(true);
    await item.click(POLL);
    await expect.element(screen.getByRole("heading", { level: 2, name: MOTOR_GUIDE.name })).toBeVisible();
    await expect.element(screen.getByTestId("reticle")).not.toBeInTheDocument();
  });

  it("frames the piece selected, following it on screen", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: MOTOR_PIECE_GUIDES[MotorPiece.Bell].name, exact: true }).click(POLL);
    const reticle = screen.getByTestId("reticle");
    await expect.poll(() => reticle.element().getBoundingClientRect().width, POLL).toBeGreaterThan(0);
  });

  it("selects the piece clicked on the model, and clears it on a second click", async () => {
    const screen = await open();
    const model = screen.getByRole("img", { name: /brushless motor/u });
    await model.click(POLL);
    const { name } = MOTOR_PIECE_GUIDES[MotorPiece.Bell];
    await expect.element(screen.getByRole("heading", { level: 2, name })).toBeVisible();
    await model.click(POLL);
    await expect.element(screen.getByRole("heading", { level: 2, name: MOTOR_GUIDE.name })).toBeVisible();
  });

  it("names the piece under the pointer", async () => {
    const screen = await open();
    const model = screen.getByRole("img", { name: /brushless motor/u });
    await userEvent.hover(model, POLL);
    const label = screen.container.querySelector("p[aria-hidden=true]");
    await expect.poll(() => label?.textContent, POLL).toBe(MOTOR_PIECE_GUIDES[MotorPiece.Bell].name);
  });

  it("takes the motor apart and puts it back together, keeping the slider in step", async () => {
    const screen = await open();
    const slider = screen.getByRole("slider", { name: "Explode" });
    await screen.getByRole("button", { name: "Take apart" }).click(POLL);
    await expect.element(slider).toHaveValue("100");
    await screen.getByRole("button", { name: "Put together" }).click(POLL);
    await expect.element(slider).toHaveValue("0");
  });

  it("lets the slider take the motor part way apart", async () => {
    const screen = await open();
    const slider = screen.getByRole("slider", { name: "Explode" });
    await slider.fill("100", POLL);
    await expect.element(screen.getByRole("button", { name: "Put together" })).toBeVisible();
  });

  it("powers the motor on, saying that it is slowed down, and off again", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: "Power on" }).click(POLL);
    const off = screen.getByRole("button", { name: "Power off" });
    await expect.element(off).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText(/Slowed right down/u)).toBeVisible();
    await off.click(POLL);
    await expect.element(screen.getByRole("button", { name: "Power on" })).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    { part: "ESC", model: /ESC/u, guide: ESC_GUIDE, piece: ESC_PIECE_GUIDES[EscPiece.Capacitor] },
    {
      part: "Flight controller",
      model: /flight controller/u,
      guide: FC_GUIDE,
      piece: FC_PIECE_GUIDES[FcPiece.BootButton],
    },
    {
      part: "Analog video",
      model: /analog video/u,
      guide: ANALOG_GUIDE,
      piece: ANALOG_PIECE_GUIDES[AnalogPiece.Antenna],
    },
    {
      part: "Digital video",
      model: /digital video/u,
      guide: DIGITAL_GUIDE,
      piece: DIGITAL_PIECE_GUIDES[DigitalPiece.Heatsink],
    },
    { part: "Frame", model: /frame/u, guide: FRAME_GUIDE, piece: FRAME_PIECE_GUIDES[FramePiece.Arms] },
    { part: "Bolts", model: /fasteners/u, guide: BOLTS_GUIDE, piece: BOLT_PIECE_GUIDES[BoltPiece.PropNut] },
  ])("switches to the $part, with its own pieces and no power switch, and back to the motor", async (shown) => {
    const screen = await open();
    await screen.getByRole("button", { name: shown.part, exact: true }).click(POLL);
    await expect.element(screen.getByRole("heading", { level: 2, name: shown.guide.name })).toBeVisible();
    await expect.element(screen.getByRole("img", { name: shown.model })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Power on" })).not.toBeInTheDocument();
    const { name, specs } = shown.piece;
    await screen.getByRole("button", { name, exact: true }).click(POLL);
    await expect.element(screen.getByText(specs)).toBeVisible();
    await screen.getByRole("button", { name: "Motor", exact: true }).click(POLL);
    await expect.element(screen.getByRole("heading", { level: 2, name: MOTOR_GUIDE.name })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Power on" })).toBeVisible();
  });

  it("shows the bolts without taking them apart, since a single fastener does not come apart", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: "Bolts", exact: true }).click(POLL);
    await expect.element(screen.getByRole("img", { name: /fasteners/u })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Take apart" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("slider", { name: "Explode" })).not.toBeInTheDocument();
  });

  it("lists common bolt sizes in a table under the bolts", async () => {
    const screen = await open();
    await screen.getByRole("button", { name: "Bolts", exact: true }).click(POLL);
    const table = screen.getByRole("table", { name: "Common FPV bolt sizes" });
    for (const { fastener, thread } of BOLT_SIZES) {
      await expect.element(table.getByRole("rowheader", { name: fastener })).toBeVisible();
      const row = table.getByRole("row").filter({ hasText: fastener });
      await expect.element(row).toBeVisible();
      expect(row.element().textContent).toContain(thread);
    }
  });

  it("fits every part's button on a phone, so the page never scrolls sideways", async () => {
    const { width, height } = { width: innerWidth, height: innerHeight };
    onTestFinished(async () => page.viewport(width, height));
    await page.viewport(PHONE.width, PHONE.height);
    const screen = await open();
    const parts = screen.getByRole("navigation", { name: "Parts" }).element();
    expect(parts.scrollWidth).toBeLessThanOrEqual(parts.clientWidth);
    expect(document.documentElement.scrollWidth).toBe(PHONE.width);
  });

  it("marks the part shown as current", async () => {
    const screen = await open();
    const parts = screen.getByRole("navigation", { name: "Parts" });
    await expect.element(parts.getByRole("button", { name: "Motor" })).toHaveAttribute("aria-current", "true");
    await expect.element(parts.getByRole("button", { name: "ESC" })).toHaveAttribute("aria-current", "false");
  });

  it("says when 3D is unavailable and keeps every piece's text reachable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const screen = await renderApp(scripted().client, ATLAS);
    await expect.element(screen.getByText(/can't show the 3D model/u), POLL).toBeVisible();
    const { name, what } = MOTOR_PIECE_GUIDES[MotorPiece.Base];
    await screen.getByRole("button", { name, exact: true }).click(POLL);
    await expect.element(screen.getByText(what)).toBeVisible();
  });
});
