import { describe, expect, it } from "vitest";
import { ANALOG_PIECE_GUIDES, DIGITAL_PIECE_GUIDES } from "../src/video-guide.ts";
import { AnalogPiece, buildAnalogVideo, buildDigitalVideo, DigitalPiece } from "../src/video-model.ts";
import { boxOf } from "./support/model-box.ts";

describe("Analog video model", () => {
  const video = buildAnalogVideo();

  it("builds every piece the guide describes, and no others", () => {
    expect(video.pieces.map(({ id }) => id)).toEqual(Object.values(AnalogPiece));
    expect(Object.keys(ANALOG_PIECE_GUIDES).toSorted()).toEqual(Object.values(AnalogPiece).toSorted());
  });

  it("stands the antenna up above everything else, clear of the VTX", () => {
    const antenna = boxOf(video, AnalogPiece.Antenna);
    for (const id of Object.values(AnalogPiece).filter((piece) => piece !== AnalogPiece.Antenna)) {
      expect(antenna.max.y).toBeGreaterThan(boxOf(video, id).max.y);
    }
    expect(antenna.min.x).toBeGreaterThan(boxOf(video, AnalogPiece.Vtx).max.x);
  });

  it("puts the lens on the front of the camera", () => {
    expect(boxOf(video, AnalogPiece.Lens).max.z).toBeGreaterThan(boxOf(video, AnalogPiece.Camera).max.z);
  });
});

describe("Digital video model", () => {
  const video = buildDigitalVideo();

  it("builds every piece the guide describes, and no others", () => {
    expect(video.pieces.map(({ id }) => id)).toEqual(Object.values(DigitalPiece));
    expect(Object.keys(DIGITAL_PIECE_GUIDES).toSorted()).toEqual(Object.values(DigitalPiece).toSorted());
  });

  it("stands the antennas up above the air unit", () => {
    expect(boxOf(video, DigitalPiece.Antennas).max.y).toBeGreaterThan(boxOf(video, DigitalPiece.Heatsink).max.y);
  });

  it("sits the heatsink on top of the air unit", () => {
    expect(boxOf(video, DigitalPiece.Heatsink).min.y).toBeCloseTo(boxOf(video, DigitalPiece.AirUnit).max.y);
  });
});

describe.each([
  { name: "Analog video", video: buildAnalogVideo() },
  { name: "Digital video", video: buildDigitalVideo() },
])("$name model", ({ video }) => {
  it("has nothing that spins and no phases to light", () => {
    expect(video.phases).toBe(0);
    expect(video.pieces.some(({ spins }) => spins)).toBe(false);
  });

  it("gives every mesh real geometry", () => {
    for (const { meshes } of video.pieces) {
      for (const { geometry } of meshes) {
        expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
      }
    }
  });
});
