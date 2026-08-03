/**
 * Character ids are persisted in the v1/v2 local player profile.  Keep these
 * stable even when the public resident name or art direction changes.
 */
export type CharacterId =
  | "rabbit"
  | "cat"
  | "fox"
  | "deer"
  | "koala"
  | "penguin"
  | "monkey"
  | "snowy"
  | "hazel";

export type CharacterRendererKind = "gltf" | "procedural-humanoid" | "biped-animal";

export type CharacterBodyFamily = "pet" | "mini-human" | "human" | "biped-animal";

export type CharacterSpecies = "human" | "cat" | "penguin" | "monkey" | "rabbit" | "fox" | "deer" | "koala" | "pigeon" | "dog" | "tiger";

export type CharacterAssetSource = {
  creator: "Kenney" | "Quaternius" | "Minimoku" | "Prometheus Studio";
  pack: string;
  url: string | null;
  license: "CC0-1.0" | "CGTrader-Royalty-Free-No-AI" | "Project-internal";
  licenseUrl: string | null;
};

export type CharacterAnimations = {
  idle: string;
  walk: string;
  run?: string;
  preview?: string;
};

export type CharacterVisualProfile = {
  scale: number;
  positionOffset: [number, number, number];
  rotation: [number, number, number];
  previewTargetHeight: number;
  worldTargetHeight: number;
  nameplateOffset: [number, number, number];
};

export type CharacterMotionProfile = {
  gait: "rigged" | "humanoid" | "waddle" | "biped-animal";
  stride: number;
  bob: number;
  idleBreath: number;
};

export type CharacterReference = {
  inspiration: string;
  match: "exact-asset" | "adapted" | "original";
  releaseNameReviewRequired: boolean;
};

export type CharacterDefinition = {
  id: CharacterId;
  name: string;
  description: string;
  /** False keeps a legacy id renderable without showing it in the resident picker. */
  selectable?: boolean;
  kind: "human" | "animal";
  renderer: CharacterRendererKind;
  bodyFamily: CharacterBodyFamily;
  species: CharacterSpecies;
  colors: {
    skin: string;
    hair: string;
    top: string;
    accent: string;
    shoes: string;
  };
  hairStyle: "short" | "bob" | "curl";
  modelUrl: string | null;
  /** Optional named sub-model selected from a multi-character source asset. */
  modelVariant?: string;
  /** The source intentionally ships without authored animation clips. */
  allowsStaticPose?: boolean;
  previewImageUrl: string | null;
  visual: CharacterVisualProfile;
  motionProfile: CharacterMotionProfile;
  reference: CharacterReference;
  /** @deprecated Use visual.scale. Retained for profile/runtime compatibility. */
  scale: number;
  /** @deprecated Use visual.positionOffset. */
  positionOffset: [number, number, number];
  /** @deprecated Use visual.rotation. */
  rotation: [number, number, number];
  collider: { radius: number; halfHeight: number };
  animations: CharacterAnimations;
  source: CharacterAssetSource;
};

export type PlayerProfile = {
  schemaVersion: 2;
  characterId: CharacterId;
  nickname: string;
  selectedAt: string;
};
