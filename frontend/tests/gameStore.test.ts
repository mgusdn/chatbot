import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "@/store/useGameStore";
import type { CounselReport } from "@/types/counseling";
import type { TransformSnapshot } from "@/types/game";

const snapshot: TransformSnapshot = {
  scene: "interior",
  position: [0, 0.78, -0.25],
  rotationY: Math.PI,
  cameraPosition: [0, 8.4, 8.2],
  cameraTarget: [0, 0.65, 0],
};

const report: CounselReport = {
  id: "run-1",
  experimentId: "experiment-1",
  arm: "optimized",
  createdAt: "2026-07-20T00:00:00.000Z",
  markdown: "## 마음 정리\n\n### 1. 지금의 마음\n- 충분히 애썼어요.",
  reportFallback: false,
  state: { stage: "done", turn_count: 12, filled_slots: [], slot_values: {} },
};

describe("counsel return state", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useGameStore.setState({ phase: "counsel-active", scene: "interior", returnSnapshot: snapshot });
  });

  it("shows an in-memory report after a normal completion and clears it on dismiss", () => {
    useGameStore.getState().completeCounsel(report);
    expect(useGameStore.getState()).toMatchObject({ phase: "leaving-counsel", counselReport: report });

    useGameStore.getState().finishCounselReturn();
    expect(useGameStore.getState()).toMatchObject({ phase: "report-active", scene: "interior", counselReport: report });

    useGameStore.getState().dismissCounselReport();
    expect(useGameStore.getState()).toMatchObject({
      phase: "exploring-interior",
      counselReport: null,
      returnSnapshot: snapshot,
      mobileMove: [0, 0],
    });
    useGameStore.getState().clearReturnSnapshot();
    expect(useGameStore.getState().returnSnapshot).toBeNull();
  });

  it("keeps the last report available to reopen after dismissal", () => {
    useGameStore.getState().completeCounsel(report);
    useGameStore.getState().finishCounselReturn();
    useGameStore.getState().dismissCounselReport();
    expect(useGameStore.getState()).toMatchObject({
      phase: "exploring-interior",
      counselReport: null,
      lastCounselReport: report,
    });

    useGameStore.getState().reopenLastReport();
    expect(useGameStore.getState()).toMatchObject({
      phase: "report-active",
      counselReport: report,
      lastCounselReport: report,
    });
  });

  it("ignores reopening the report when there is nothing to show or input is locked", () => {
    useGameStore.setState({ phase: "exploring-interior", lastCounselReport: null });
    useGameStore.getState().reopenLastReport();
    expect(useGameStore.getState().phase).toBe("exploring-interior");

    useGameStore.getState().completeCounsel(report);
    useGameStore.getState().finishCounselReturn();
    useGameStore.getState().dismissCounselReport();
    useGameStore.setState({ phase: "counsel-active" });
    useGameStore.getState().reopenLastReport();
    expect(useGameStore.getState().phase).toBe("counsel-active");
  });

  it("returns without a report when counseling is closed early", () => {
    useGameStore.getState().closeCounsel();
    useGameStore.getState().finishCounselReturn();
    expect(useGameStore.getState()).toMatchObject({
      phase: "exploring-interior",
      scene: "interior",
      counselReport: null,
      returnSnapshot: snapshot,
    });
  });

  it("ignores a late completion after the user has already left", () => {
    useGameStore.getState().closeCounsel();
    useGameStore.getState().completeCounsel(report);
    expect(useGameStore.getState()).toMatchObject({ phase: "leaving-counsel", counselReport: null });
  });

  it("pauses a commons station independently and clears it before counseling", () => {
    useGameStore.setState({ phase: "exploring-interior", activeCommonsStation: null });
    useGameStore.getState().openCommonsStation("guestbook");
    expect(useGameStore.getState()).toMatchObject({
      phase: "exploring-interior",
      activeCommonsStation: "guestbook",
      mobileMove: [0, 0],
    });

    useGameStore.setState({ phase: "interaction-ready", nearbyInteractable: "pbao" });
    useGameStore.getState().beginCounsel(snapshot);
    expect(useGameStore.getState()).toMatchObject({
      phase: "entering-counsel",
      activeCommonsStation: null,
    });
  });

  it("copies the exact pre-counsel transform instead of retaining caller-owned tuples", () => {
    const mutableSnapshot: TransformSnapshot = {
      ...snapshot,
      position: [...snapshot.position],
      cameraPosition: [...snapshot.cameraPosition],
      cameraTarget: [...snapshot.cameraTarget],
    };
    useGameStore.setState({ phase: "interaction-ready", nearbyInteractable: "pbao" });
    useGameStore.getState().beginCounsel(mutableSnapshot);

    mutableSnapshot.position[0] = 99;
    mutableSnapshot.cameraPosition[0] = 99;
    mutableSnapshot.cameraTarget[0] = 99;
    expect(useGameStore.getState().returnSnapshot).toEqual(snapshot);
  });

  it("keeps movement, proximity and interaction input locked while the report is open", () => {
    useGameStore.getState().completeCounsel(report);
    useGameStore.getState().finishCounselReturn();
    const interactionNonce = useGameStore.getState().interactionNonce;

    useGameStore.getState().setMobileMove([1, -1]);
    useGameStore.getState().setNearbyInteractable("pbao");
    useGameStore.getState().requestInteraction();

    expect(useGameStore.getState()).toMatchObject({
      phase: "report-active",
      nearbyInteractable: null,
      mobileMove: [0, 0],
      interactionNonce,
    });
  });

  it("consumes a captured interaction only once across controller remounts", () => {
    useGameStore.setState({
      phase: "interaction-ready",
      nearbyInteractable: "pbao",
    });

    useGameStore.getState().requestInteraction();
    expect(useGameStore.getState().consumeInteraction()).toBe("pbao");
    expect(useGameStore.getState().consumeInteraction()).toBeNull();

    useGameStore.setState({ nearbyInteractable: "exit-house" });
    expect(useGameStore.getState().consumeInteraction()).toBeNull();
  });

  it("resumes the scene captured before counseling after dismissing the report", () => {
    const exteriorSnapshot: TransformSnapshot = { ...snapshot, scene: "exterior" };
    useGameStore.setState({
      phase: "counsel-active",
      scene: "interior",
      returnSnapshot: exteriorSnapshot,
    });

    useGameStore.getState().completeCounsel(report);
    useGameStore.getState().finishCounselReturn();
    expect(useGameStore.getState()).toMatchObject({ phase: "report-active", scene: "exterior" });

    useGameStore.getState().dismissCounselReport();
    expect(useGameStore.getState()).toMatchObject({
      phase: "exploring-exterior",
      scene: "exterior",
      counselReport: null,
      returnSnapshot: exteriorSnapshot,
    });
  });
});
