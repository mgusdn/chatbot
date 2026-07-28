import type { GameEvent, GamePhase, GameScene, TransformSnapshot } from "@/types/game";

export function explorationPhaseForScene(scene: GameScene): Extract<GamePhase, "exploring-exterior" | "exploring-interior"> {
  return scene === "interior" ? "exploring-interior" : "exploring-exterior";
}

export function isWorldInputPhase(phase: GamePhase): boolean {
  return phase === "exploring-exterior" || phase === "exploring-interior" || phase === "interaction-ready";
}

export function cloneTransformSnapshot(snapshot: TransformSnapshot): TransformSnapshot {
  return {
    scene: snapshot.scene,
    position: [...snapshot.position],
    rotationY: snapshot.rotationY,
    cameraPosition: [...snapshot.cameraPosition],
    cameraTarget: [...snapshot.cameraTarget],
  };
}

export function transitionGamePhase(phase: GamePhase, event: GameEvent): GamePhase {
  switch (event.type) {
    case "START_CLICK":
      return phase === "entry" ? "character-select" : phase;
    case "CONFIRM_CHARACTER":
      return phase === "character-select" ? "preloading" : phase;
    case "WORLD_READY":
      return phase === "preloading" || phase === "spawning" ? "exploring-exterior" : phase;
    case "ENTER_BUILDING":
      return phase === "exploring-exterior" || phase === "interaction-ready" ? "entering-building" : phase;
    case "ENTER_NPC_RANGE":
      return phase === "exploring-interior" || phase === "exploring-exterior" ? "interaction-ready" : phase;
    case "LEAVE_NPC_RANGE":
      return phase === "interaction-ready" ? "exploring-interior" : phase;
    case "INTERACT":
      return phase === "interaction-ready" ? "entering-counsel" : phase;
    case "TRANSITION_DONE":
      return phase === "entering-counsel" ? "counsel-active" : phase;
    case "COUNSEL_COMPLETE":
      return phase === "counsel-active" ? "leaving-counsel" : phase;
    case "CLOSE_COUNSEL":
      return phase === "counsel-active" ? "leaving-counsel" : phase;
    case "RETURN_DONE":
      return phase === "leaving-counsel" ? explorationPhaseForScene(event.scene ?? "interior") : phase;
    case "REPORT_READY":
      return phase === "leaving-counsel" ? "report-active" : phase;
    case "DISMISS_REPORT":
      return phase === "report-active" ? explorationPhaseForScene(event.scene ?? "interior") : phase;
    case "SELECT_CHARACTER":
      return phase;
    default:
      return phase;
  }
}

export function withinRadius(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
  radius: number,
) {
  const x = position[0] - target[0];
  const z = position[2] - target[2];
  return x * x + z * z <= radius * radius;
}
