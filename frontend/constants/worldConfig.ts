import { INTERIOR_HALF_DEPTH } from "@/constants/interiorLayout";

export const WORLD_CONFIG = {
  exteriorSpawn: [0, 0.78, 7] as [number, number, number],
  interiorSpawn: [0, 0.78, INTERIOR_HALF_DEPTH - 1.3] as [number, number, number],
  houseDoor: [0, 0, -6.35] as [number, number, number],
  interiorExit: [0, 0, INTERIOR_HALF_DEPTH - 0.4] as [number, number, number],
  pbaoInteraction: [0, 0, -3.85] as [number, number, number],
  walkSpeed: 2.5,
  runSpeed: 4,
  interactionRadius: 1.9,
  cameraOffset: [0, 12.8, 10] as [number, number, number],
  interiorCameraOffset: [0, 12.8, 10] as [number, number, number],
} as const;
