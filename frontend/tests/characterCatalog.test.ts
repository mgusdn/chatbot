import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_CATALOG,
  isCharacterId,
  resolveSelectableCharacterId,
  SELECTABLE_CHARACTER_CATALOG,
} from "@/constants/characterCatalog";

const LEGACY_PERSISTED_IDS = [
  "sprout", "cloud", "acorn", "rabbit", "cat", "fox", "deer", "koala", "penguin", "monkey", "mira", "pug",
] as const;

describe("character catalog", () => {
  it("contains the agreed six-animal and six-human roster", () => {
    expect(CHARACTER_CATALOG).toHaveLength(12);
    expect(new Set(CHARACTER_CATALOG.map((character) => character.id)).size).toBe(12);
    expect(CHARACTER_CATALOG.filter((character) => character.kind === "animal")).toHaveLength(6);
    expect(CHARACTER_CATALOG.filter((character) => character.kind === "human")).toHaveLength(6);

    const animalNames = CHARACTER_CATALOG
      .filter((character) => character.kind === "animal")
      .map((character) => character.name);
    const humanNames = CHARACTER_CATALOG
      .filter((character) => character.kind === "human")
      .map((character) => character.name);

    expect(animalNames).toEqual(["나비", "파도", "콩이", "마스터", "여울", "비앙카"]);
    expect(humanNames).toEqual(["새싹이", "구름이", "도토리", "마루", "미라", "하루"]);
  });

  it("retires Master from the visible eleven-resident picker without breaking legacy ids", () => {
    expect(SELECTABLE_CHARACTER_CATALOG).toHaveLength(11);
    expect(SELECTABLE_CHARACTER_CATALOG.filter((character) => character.kind === "animal")).toHaveLength(5);
    expect(SELECTABLE_CHARACTER_CATALOG.filter((character) => character.kind === "human")).toHaveLength(6);
    expect(SELECTABLE_CHARACTER_CATALOG.some((character) => character.id === "rabbit")).toBe(false);
    expect(resolveSelectableCharacterId("rabbit")).toBe("fox");
    expect(resolveSelectableCharacterId("deer")).toBe("deer");
    expect(resolveSelectableCharacterId(null)).toBeNull();
  });

  it("keeps every persisted v1/v2 id valid across the art-direction migration", () => {
    for (const id of LEGACY_PERSISTED_IDS) expect(isCharacterId(id)).toBe(true);
    expect(isCharacterId("master")).toBe(false);
    expect(isCharacterId("pbao")).toBe(false);
    expect(isCharacterId(null)).toBe(false);
  });

  it("declares renderer, body, visual, motion, and reference contracts", () => {
    for (const character of CHARACTER_CATALOG) {
      expect(["gltf", "procedural-humanoid", "biped-animal"]).toContain(character.renderer);
      expect(character.bodyFamily).toBeTruthy();
      expect(character.visual.scale).toBeGreaterThan(0);
      expect(character.visual.positionOffset).toHaveLength(3);
      expect(character.visual.nameplateOffset).toHaveLength(3);
      expect(character.visual.previewTargetHeight).toBeGreaterThan(0);
      expect(character.visual.worldTargetHeight).toBeGreaterThan(0);
      expect(character.motionProfile.stride).toBeGreaterThan(0);
      expect(character.reference.inspiration).toBeTruthy();
      expect(character.animations.idle).toBeTruthy();
      expect(character.animations.walk).toBeTruthy();
      expect(character.animations.preview).toBeTruthy();
      expect(character.scale).toBe(character.visual.scale);
      expect(character.positionOffset).toBe(character.visual.positionOffset);
      expect(character.rotation).toBe(character.visual.rotation);
    }
  });

  it("uses existing files for GLTF residents and original code provenance for procedural residents", () => {
    for (const character of CHARACTER_CATALOG) {
      if (character.renderer === "gltf") {
        expect(character.modelUrl).not.toBeNull();
        expect(existsSync(join(process.cwd(), "public", character.modelUrl as string))).toBe(true);
        expect(["CC0-1.0", "CGTrader-Royalty-Free-No-AI"]).toContain(character.source.license);
      } else {
        expect(character.modelUrl).toBeNull();
        expect(character.source.creator).toBe("Prometheus Studio");
        expect(character.source.license).toBe("Project-internal");
      }
    }
  });

  it("renders visible Yeoul and Bianca from the downloaded Cute Bunny GLB", () => {
    const replacements = SELECTABLE_CHARACTER_CATALOG.filter(({ id }) => ["fox", "deer"].includes(id));
    expect(replacements).toHaveLength(2);
    expect(new Set(replacements.map(({ modelUrl }) => modelUrl))).toEqual(new Set([
      "/models/characters/cgtrader-cute-bunny/cute-bunny.glb",
    ]));
    expect(replacements.map(({ renderer }) => renderer)).toEqual(["gltf", "gltf"]);
    expect(replacements.every(({ source }) => source.creator === "Minimoku")).toBe(true);
    expect(replacements.every(({ source }) => source.license === "CGTrader-Royalty-Free-No-AI")).toBe(true);
    expect(replacements.every(({ allowsStaticPose }) => allowsStaticPose)).toBe(true);
  });

  it("keeps cosmetic selection fair with one shared movement collider", () => {
    expect(new Set(CHARACTER_CATALOG.map((character) => JSON.stringify(character.collider))).size).toBe(1);
  });

  it("ships the counselor as the recovered project-internal procedural panda", () => {
    expect(CHARACTER_CATALOG.some((character) => character.id === ("pbao" as never))).toBe(false);
    const pbaoSource = readFileSync(join(process.cwd(), "components/game/PbaoModel.tsx"), "utf8");
    expect(pbaoSource).toContain('locomotion: "stationary"');
    expect(pbaoSource).toContain('assetCreator: "Prometheus Studio"');
    expect(pbaoSource).toContain('assetLicense: "Project-internal"');
    expect(pbaoSource).toContain('renderer: "procedural-panda"');
    expect(pbaoSource).toContain("useFrame");
    expect(pbaoSource).toContain("sphereGeometry");
    expect(pbaoSource).toContain('color="#70815a"');
    expect(pbaoSource).not.toContain("useGLTF");
    expect(pbaoSource).not.toContain("Panda.glb");
    expect(existsSync(join(
      process.cwd(),
      "public/models/characters/quaternius-modular-sushi/Panda.glb",
    ))).toBe(true);
  });
});
