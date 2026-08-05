import type {
  CharacterAssetSource,
  CharacterDefinition,
  CharacterId,
  CharacterMotionProfile,
  CharacterVisualProfile,
} from "@/types/character";

const CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/" as const;

const KENNEY_PETS_SOURCE: CharacterAssetSource = {
  creator: "Kenney",
  pack: "Cube Pets",
  url: "https://kenney.nl/assets/cube-pets",
  license: "CC0-1.0",
  licenseUrl: CC0_LICENSE_URL,
};

const CUTE_BUNNY_LISTING_URL = "https://www.cgtrader.com/free-3d-models/animal/mammal/cute-bunny-772af610-f9f8-47c2-a8b8-7adcca89dc48" as const;
const CUTE_BUNNY_MODEL_URL = "/models/characters/cgtrader-cute-bunny/cute-bunny.glb" as const;

const MINIMOKU_CUTE_BUNNY_SOURCE: CharacterAssetSource = {
  creator: "Minimoku",
  pack: "Cute Bunny",
  url: CUTE_BUNNY_LISTING_URL,
  license: "CGTrader-Royalty-Free-No-AI",
  licenseUrl: "https://www.cgtrader.com/pages/terms-and-conditions",
};

const SHARED_COLLIDER = { radius: 0.32, halfHeight: 0.36 } as const;
const KENNEY_PET_ANIMATIONS = { idle: "idle", walk: "walk", run: "run", preview: "dance" } as const;
const STATIC_BUNNY_ANIMATIONS = {
  idle: "static-idle",
  walk: "static-walk",
  run: "static-run",
  preview: "static-preview",
} as const;

const PET_VISUAL: CharacterVisualProfile = {
  scale: 1.05,
  positionOffset: [0, -0.68, 0],
  rotation: [0, 0, 0],
  previewTargetHeight: 0.55,
  worldTargetHeight: 0.48,
  nameplateOffset: [0, 1.12, 0],
};

const CUTE_BUNNY_VISUAL: CharacterVisualProfile = {
  scale: 0.21,
  positionOffset: [0, -0.75, 0],
  rotation: [0, 0, 0],
  previewTargetHeight: 0.86,
  worldTargetHeight: 0.78,
  nameplateOffset: [0, 1.08, 0],
};

const PET_MOTION: CharacterMotionProfile = { gait: "waddle", stride: 0.84, bob: 0.035, idleBreath: 0.012 };
const CUTE_BUNNY_MOTION: CharacterMotionProfile = { gait: "waddle", stride: 0.72, bob: 0.045, idleBreath: 0.012 };

type CatalogInput = Omit<CharacterDefinition, "scale" | "positionOffset" | "rotation" | "collider">;

function defineCharacter(definition: CatalogInput): CharacterDefinition {
  return {
    ...definition,
    scale: definition.visual.scale,
    positionOffset: definition.visual.positionOffset,
    rotation: definition.visual.rotation,
    collider: SHARED_COLLIDER,
  };
}

/**
 * The ids deliberately remain the original shipped ids. Existing v1/v2 local
 * profiles therefore hydrate safely while the visible roster moves to the new
 * six-animal / six-human direction.
 */
export const CHARACTER_CATALOG: readonly CharacterDefinition[] = [
  defineCharacter({
    id: "cat",
    name: "나비",
    description: "조용한 자리를 찾아 이야기를 듣는 작은 고양이 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "pet",
    species: "cat",
    colors: { skin: "#e7d7bf", hair: "#8c7867", top: "#d7b889", accent: "#f2ede1", shoes: "#7d695b" },
    hairStyle: "bob",
    modelUrl: "/models/characters/kenney-cube-pets/animal-cat.glb",
    previewImageUrl: "/images/characters/animal-cat.png",
    visual: PET_VISUAL,
    motionProfile: PET_MOTION,
    reference: { inspiration: "사이다", match: "adapted", releaseNameReviewRequired: false },
    animations: KENNEY_PET_ANIMATIONS,
    source: KENNEY_PETS_SOURCE,
  }),
  defineCharacter({
    id: "penguin",
    name: "파도",
    description: "바닷바람처럼 경쾌하게 곁을 따라오는 작은 펭귄 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "pet",
    species: "penguin",
    colors: { skin: "#f3ead9", hair: "#313b46", top: "#4f6572", accent: "#e2b75f", shoes: "#cf8550" },
    hairStyle: "short",
    modelUrl: "/models/characters/kenney-cube-pets/animal-penguin.glb",
    previewImageUrl: "/images/characters/animal-penguin.png",
    visual: PET_VISUAL,
    motionProfile: PET_MOTION,
    reference: { inspiration: "참돌이", match: "adapted", releaseNameReviewRequired: false },
    animations: KENNEY_PET_ANIMATIONS,
    source: KENNEY_PETS_SOURCE,
  }),
  defineCharacter({
    id: "monkey",
    name: "콩이",
    description: "궁금한 것을 먼저 살펴보고 돌아오는 장난꾸러기 작은 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "pet",
    species: "monkey",
    colors: { skin: "#e8c98f", hair: "#775646", top: "#d9b56e", accent: "#f4e4bd", shoes: "#62483c" },
    hairStyle: "curl",
    modelUrl: "/models/characters/kenney-cube-pets/animal-monkey.glb",
    previewImageUrl: "/images/characters/animal-monkey.png",
    visual: PET_VISUAL,
    motionProfile: PET_MOTION,
    reference: { inspiration: "마티", match: "adapted", releaseNameReviewRequired: false },
    animations: KENNEY_PET_ANIMATIONS,
    source: KENNEY_PETS_SOURCE,
  }),
  defineCharacter({
    id: "rabbit",
    name: "마스터",
    description: "따뜻한 차와 함께 천천히 이야기를 들어주는 갈색 토끼 주민",
    selectable: false,
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "biped-animal",
    species: "rabbit",
    colors: { skin: "#91a9aa", hair: "#4e6d71", top: "#5f4c40", accent: "#c76858", shoes: "#795847" },
    hairStyle: "short",
    modelUrl: CUTE_BUNNY_MODEL_URL,
    modelVariant: "bunny1",
    allowsStaticPose: true,
    previewImageUrl: null,
    visual: CUTE_BUNNY_VISUAL,
    motionProfile: CUTE_BUNNY_MOTION,
    reference: { inspiration: "마스터", match: "adapted", releaseNameReviewRequired: true },
    animations: STATIC_BUNNY_ANIMATIONS,
    source: MINIMOKU_CUTE_BUNNY_SOURCE,
  }),
  defineCharacter({
    id: "fox",
    name: "여울",
    description: "처음 온 이에게도 다정하게 길을 안내하는 여우 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "pet",
    species: "fox",
    colors: { skin: "#e8c45f", hair: "#caa33d", top: "#7da887", accent: "#f3e5b4", shoes: "#855e43" },
    hairStyle: "short",
    modelUrl: "/models/characters/kenney-cube-pets/animal-fox.glb",
    previewImageUrl: "/images/characters/animal-fox.png",
    visual: PET_VISUAL,
    motionProfile: PET_MOTION,
    reference: { inspiration: "여울", match: "adapted", releaseNameReviewRequired: true },
    animations: KENNEY_PET_ANIMATIONS,
    source: KENNEY_PETS_SOURCE,
  }),
  defineCharacter({
    id: "deer",
    name: "비앙카",
    description: "단정한 마음과 씩씩한 발걸음을 가진 사슴 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "pet",
    species: "deer",
    colors: { skin: "#f1eee5", hair: "#8f79a4", top: "#b58ac2", accent: "#574d67", shoes: "#5b5264" },
    hairStyle: "bob",
    modelUrl: "/models/characters/kenney-cube-pets/animal-deer.glb",
    previewImageUrl: "/images/characters/animal-deer.png",
    visual: PET_VISUAL,
    motionProfile: PET_MOTION,
    reference: { inspiration: "비앙카", match: "adapted", releaseNameReviewRequired: true },
    animations: KENNEY_PET_ANIMATIONS,
    source: KENNEY_PETS_SOURCE,
  }),
  defineCharacter({
    id: "koala",
    name: "마루",
    description: "햇살 드는 마루처럼 편안한 온도를 건네는 코알라 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "pet",
    species: "koala",
    colors: { skin: "#d5a17e", hair: "#483a35", top: "#879d83", accent: "#e4c79b", shoes: "#55483f" },
    hairStyle: "short",
    modelUrl: "/models/characters/kenney-cube-pets/animal-koala.glb",
    previewImageUrl: "/images/characters/animal-koala.png",
    visual: PET_VISUAL,
    motionProfile: PET_MOTION,
    reference: { inspiration: "편안한 마을 주민", match: "adapted", releaseNameReviewRequired: false },
    animations: KENNEY_PET_ANIMATIONS,
    source: KENNEY_PETS_SOURCE,
  }),
  defineCharacter({
    id: "snowy",
    name: "송이",
    description: "처음 온 이에게도 다정하게 길을 안내하는 하얀 토끼 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "biped-animal",
    species: "rabbit",
    colors: { skin: "#e8c45f", hair: "#caa33d", top: "#7da887", accent: "#f3e5b4", shoes: "#855e43" },
    hairStyle: "short",
    modelUrl: CUTE_BUNNY_MODEL_URL,
    modelVariant: "bunny2",
    allowsStaticPose: true,
    previewImageUrl: "/images/characters/animal-snowy.png",
    visual: CUTE_BUNNY_VISUAL,
    motionProfile: CUTE_BUNNY_MOTION,
    reference: { inspiration: "송이", match: "adapted", releaseNameReviewRequired: true },
    animations: STATIC_BUNNY_ANIMATIONS,
    source: MINIMOKU_CUTE_BUNNY_SOURCE,
  }),
  defineCharacter({
    id: "hazel",
    name: "밤이",
    description: "단정한 스카프와 씩씩한 마음을 품은 갈색 토끼 친구",
    kind: "animal",
    renderer: "gltf",
    bodyFamily: "biped-animal",
    species: "rabbit",
    colors: { skin: "#f1eee5", hair: "#8f79a4", top: "#b58ac2", accent: "#574d67", shoes: "#5b5264" },
    hairStyle: "bob",
    modelUrl: CUTE_BUNNY_MODEL_URL,
    modelVariant: "bunny1",
    allowsStaticPose: true,
    previewImageUrl: "/images/characters/animal-hazel.png",
    visual: CUTE_BUNNY_VISUAL,
    motionProfile: CUTE_BUNNY_MOTION,
    reference: { inspiration: "밤이", match: "adapted", releaseNameReviewRequired: true },
    animations: STATIC_BUNNY_ANIMATIONS,
    source: MINIMOKU_CUTE_BUNNY_SOURCE,
  }),
];

export const SELECTABLE_CHARACTER_CATALOG = CHARACTER_CATALOG.filter(
  (character) => character.selectable !== false,
);

export const PLAYABLE_CHARACTER_IDS = SELECTABLE_CHARACTER_CATALOG.map(
  (character) => character.id,
) as CharacterId[];

export const CHARACTER_BY_ID = Object.fromEntries(
  CHARACTER_CATALOG.map((character) => [character.id, character]),
) as Record<CharacterId, CharacterDefinition>;

export function resolveSelectableCharacterId(characterId: CharacterId | null): CharacterId | null {
  if (!characterId) return null;
  if (characterId === "rabbit") return "fox";
  return SELECTABLE_CHARACTER_CATALOG.some((character) => character.id === characterId)
    ? characterId
    : null;
}

export const isCharacterId = (value: unknown): value is CharacterId =>
  typeof value === "string" && Object.hasOwn(CHARACTER_BY_ID, value);
