import { describe, expect, it } from "vitest";
import {
  cloneTransformSnapshot,
  explorationPhaseForScene,
  isWorldInputPhase,
  transitionGamePhase,
  withinRadius,
} from "@/lib/gameState";
import type { TransformSnapshot } from "@/types/game";

describe("game phase transition", () => {
  it("follows entry, select, world, counsel and return", () => {
    expect(transitionGamePhase("entry", { type: "START_CLICK" })).toBe("character-select");
    expect(transitionGamePhase("character-select", { type: "CONFIRM_CHARACTER" })).toBe("preloading");
    expect(transitionGamePhase("preloading", { type: "WORLD_READY" })).toBe("exploring-exterior");
    expect(transitionGamePhase("interaction-ready", { type: "INTERACT" })).toBe("entering-counsel");
    expect(transitionGamePhase("entering-counsel", { type: "TRANSITION_DONE" })).toBe("counsel-active");
    expect(transitionGamePhase("counsel-active", { type: "CLOSE_COUNSEL" })).toBe("leaving-counsel");
  });

  it("returns through a report only after a completed counsel", () => {
    expect(transitionGamePhase("counsel-active", { type: "COUNSEL_COMPLETE" })).toBe("leaving-counsel");
    expect(transitionGamePhase("leaving-counsel", { type: "REPORT_READY" })).toBe("report-active");
    expect(transitionGamePhase("report-active", { type: "DISMISS_REPORT" })).toBe("exploring-interior");
    expect(transitionGamePhase("report-active", { type: "DISMISS_REPORT", scene: "exterior" })).toBe("exploring-exterior");
  });

  it("does not open a report for a manual return", () => {
    expect(transitionGamePhase("counsel-active", { type: "CLOSE_COUNSEL" })).toBe("leaving-counsel");
    expect(transitionGamePhase("leaving-counsel", { type: "RETURN_DONE" })).toBe("exploring-interior");
    expect(transitionGamePhase("leaving-counsel", { type: "RETURN_DONE", scene: "exterior" })).toBe("exploring-exterior");
  });

  it("does not allow counsel from a non-interactive phase", () => {
    expect(transitionGamePhase("exploring-interior", { type: "INTERACT" })).toBe("exploring-interior");
  });
});

describe("world return helpers", () => {
  it("maps each world scene to its matching exploration phase", () => {
    expect(explorationPhaseForScene("exterior")).toBe("exploring-exterior");
    expect(explorationPhaseForScene("interior")).toBe("exploring-interior");
  });

  it("allows world input only while actively exploring or interaction-ready", () => {
    expect(isWorldInputPhase("exploring-exterior")).toBe(true);
    expect(isWorldInputPhase("interaction-ready")).toBe(true);
    expect(isWorldInputPhase("leaving-counsel")).toBe(false);
    expect(isWorldInputPhase("report-active")).toBe(false);
  });

  it("copies every mutable tuple in a return snapshot", () => {
    const source: TransformSnapshot = {
      scene: "interior",
      position: [1, 2, 3],
      rotationY: 0.75,
      cameraPosition: [4, 5, 6],
      cameraTarget: [7, 8, 9],
    };
    const copied = cloneTransformSnapshot(source);

    source.position[0] = 100;
    source.cameraPosition[1] = 200;
    source.cameraTarget[2] = 300;
    expect(copied).toEqual({
      scene: "interior",
      position: [1, 2, 3],
      rotationY: 0.75,
      cameraPosition: [4, 5, 6],
      cameraTarget: [7, 8, 9],
    });
  });
});

describe("proximity", () => {
  it("checks the x/z distance without vertical jitter", () => {
    expect(withinRadius([0, 100, 0], [0, 0, 1], 1.1)).toBe(true);
    expect(withinRadius([0, 0, 0], [0, 0, 2], 1.9)).toBe(false);
  });
});
