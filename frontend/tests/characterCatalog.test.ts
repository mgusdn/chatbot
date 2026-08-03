import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_CATALOG,
  isCharacterId,
  resolveSelectableCharacterId,
  SELECTABLE_CHARACTER_CATALOG,
} from "@/constants/characterCatalog";

const CURRENT_PERSISTED_IDS = [
  "rabbit", "cat", "fox", "deer", "koala", "penguin", "monkey", "snowy", "hazel",
] as const;

describe("character catalog", () => {
  it("contains the nine-animal roster", () => {
    expect(CHARACTER_CATALOG).toHaveLength(9);
    expect(new Set(CHARACTER_CATALOG.map((character) => character.id)).size).toBe(9);
    expect(CHARACTER_CATALOG.filter((character) => character.kind === "animal")).toHaveLength(9);
    expect(CHARACTER_CATALOG.filter((character) => character.kind === "human")).toHaveLength(0);

    const animalNames = CHARACTER_CATALOG
      .filter((character) => character.kind === "animal")
      .map((character) => character.name);

    expect(animalNames).toEqual(["나비", "파도", "콩이", "마스터", "여울", "비앙카", "마루", "송이", "밤이"]);
  });

  it("retires Master from the visible eight-resident picker without breaking legacy ids", () => {
    expect(SELECTABLE_CHARACTER_CATALOG).toHaveLength(8);
    expect(SELECTABLE_CHARACTER_CATALOG.filter((character) => character.kind === "animal")).toHaveLength(8);
    expect(SELECTABLE_CHARACTER_CATALOG.some((character) => character.id === "rabbit")).toBe(false);
    expect(resolveSelectableCharacterId("rabbit")).toBe("fox");
    expect(resolveSelectableCharacterId("deer")).toBe("deer");
    expect(resolveSelectableCharacterId(null)).toBeNull();
  });

  it("keeps every currently persisted id valid; fully-retired ids fall back to reselection", () => {
    for (const id of CURRENT_PERSISTED_IDS) expect(isCharacterId(id)).toBe(true);
    // sprout/cloud/acorn/mira/pug were removed outright (not just re-skinned), so a
    // profile saved under one of those ids no longer resolves — the player is
    // simply asked to pick again, same as any other unrecognized id.
    expect(isCharacterId("sprout")).toBe(false);
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

  it("renders Yeoul, Bianca, and Maru as their own distinct Cube Pets GLBs", () => {
    const replacements = SELECTABLE_CHARACTER_CATALOG.filter(({ id }) => ["fox", "deer", "koala"].includes(id));
    expect(replacements).toHaveLength(3);
    // Each gets its own model file now, unlike the old shared-bunny placeholder.
    expect(new Set(replacements.map(({ modelUrl }) => modelUrl)).size).toBe(3);
    expect(replacements.map(({ renderer }) => renderer)).toEqual(["gltf", "gltf", "gltf"]);
    expect(replacements.every(({ bodyFamily }) => bodyFamily === "pet")).toBe(true);
    expect(replacements.every(({ source }) => source.creator === "Kenney")).toBe(true);
    expect(replacements.every(({ source }) => source.license === "CC0-1.0")).toBe(true);
    replacements.forEach(({ id, modelUrl }) => {
      expect(modelUrl).toBe(`/models/characters/kenney-cube-pets/animal-${id}.glb`);
    });
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
