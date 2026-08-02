"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  Color,
  Group,
  LoopRepeat,
  MathUtils,
  Mesh,
  type Material,
  type Object3D,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterDefinition } from "@/types/character";
import { BipedAnimalCharacter } from "./BipedAnimalCharacter";
import { resolveCharacterAnimationClip } from "./characterAnimation";
import { ProceduralCharacter } from "./ProceduralCharacter";

type Props = {
  character: CharacterDefinition;
  moving?: boolean;
  running?: boolean;
  preview?: boolean;
};

type TintableMaterial = Material & {
  color?: Color;
  roughness?: number;
};

function toneQuaterniusMaterial(material: Material, character: CharacterDefinition) {
  const toned = material.clone() as TintableMaterial;
  const palette: Record<string, string> = {
    skin: character.colors.skin,
    face: character.colors.skin,
    shirt: character.colors.top,
    pants: "#66727a",
    belt: "#5a463b",
    hair: character.colors.hair,
    purple: character.colors.top,
    lightblue: character.colors.accent,
  };
  const color = palette[material.name.toLocaleLowerCase()];

  if (color && toned.color instanceof Color) toned.color.set(color);
  if (typeof toned.roughness === "number") toned.roughness = Math.max(toned.roughness, 0.72);
  toned.needsUpdate = true;
  return toned;
}

function toneCuteBunnyMaterial(material: Material, character: CharacterDefinition) {
  const toned = material.clone() as TintableMaterial;
  const materialName = material.name.toLocaleLowerCase();

  if ((materialName.includes("scarf") || materialName.includes("scraf")) && toned.color instanceof Color) {
    toned.color.set(character.colors.accent);
  }
  if (typeof toned.roughness === "number") toned.roughness = Math.max(toned.roughness, 0.8);
  toned.needsUpdate = true;
  return toned;
}

function selectCuteBunnyVariant(scene: Object3D, character: CharacterDefinition) {
  const variant = character.modelVariant === "bunny2" ? "bunny2" : "bunny1";
  const oppositeVariant = variant === "bunny1" ? "bunny2" : "bunny1";

  for (const child of scene.children) {
    if (child.name.startsWith(`${oppositeVariant}_`)) child.visible = false;
  }
  scene.position.x = variant === "bunny1" ? 2.5 : -2.5;
}

type CuteBunnyLimbRig = {
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  geometries: BufferGeometry[];
};

type SplitLimb = {
  negative: Group;
  positive: Group;
  geometries: BufferGeometry[];
};

function geometryHalfAtLocalX(geometry: BufferGeometry, negative: boolean) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position || !index) return null;

  const triangleIndices: number[] = [];
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const centroidX = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    if ((centroidX < 0) === negative) triangleIndices.push(a, b, c);
  }
  if (!triangleIndices.length) return null;

  const half = geometry.clone();
  half.setIndex(triangleIndices);
  half.clearGroups();
  half.addGroup(0, triangleIndices.length, 0);
  half.computeBoundingBox();
  half.computeBoundingSphere();
  return half;
}

function pivotedLimbHalf(
  source: Mesh,
  geometry: BufferGeometry,
  name: string,
  pivot: [number, number, number],
  restRotationZ = 0,
) {
  const hinge = new Group();
  hinge.name = `${name}-hinge`;
  hinge.position.set(...pivot);

  const restPose = new Group();
  restPose.name = `${name}-rest-pose`;
  // Keep the authored side pose separate so the outer hinge can still swing cleanly while walking.
  restPose.rotation.z = restRotationZ;

  const limb = new Mesh(geometry, source.material);
  limb.name = name;
  limb.position.set(-pivot[0], -pivot[1], -pivot[2]);
  limb.castShadow = source.castShadow;
  limb.receiveShadow = source.receiveShadow;
  restPose.add(limb);
  hinge.add(restPose);
  return hinge;
}

function splitCuteBunnyLimb(
  scene: Object3D,
  nodeName: string,
  pivotX: number,
  pivotY: number,
  restRotationZ = 0,
): SplitLimb | null {
  const source = scene.getObjectByName(nodeName);
  if (!(source instanceof Mesh) || !source.parent) return null;

  const negativeGeometry = geometryHalfAtLocalX(source.geometry, true);
  const positiveGeometry = geometryHalfAtLocalX(source.geometry, false);
  if (!negativeGeometry || !positiveGeometry) {
    negativeGeometry?.dispose();
    positiveGeometry?.dispose();
    return null;
  }

  const assembly = new Group();
  assembly.name = `${nodeName}-assembly`;
  assembly.position.copy(source.position);
  assembly.quaternion.copy(source.quaternion);
  assembly.scale.copy(source.scale);
  assembly.visible = source.visible;

  const negative = pivotedLimbHalf(
    source,
    negativeGeometry,
    `${nodeName}-left`,
    [-pivotX, pivotY, 0],
    restRotationZ,
  );
  const positive = pivotedLimbHalf(
    source,
    positiveGeometry,
    `${nodeName}-right`,
    [pivotX, pivotY, 0],
    -restRotationZ,
  );
  assembly.add(negative, positive);
  source.parent.add(assembly);
  source.parent.remove(source);

  return { negative, positive, geometries: [negativeGeometry, positiveGeometry] };
}

function createCuteBunnyLimbRig(scene: Object3D, character: CharacterDefinition): CuteBunnyLimbRig | null {
  const variant = character.modelVariant === "bunny2" ? "bunny2" : "bunny1";
  const arms = splitCuteBunnyLimb(scene, `${variant}_arms`, 0.6, 2.48, 0.95);
  const legs = splitCuteBunnyLimb(scene, `${variant}_legs`, 0.48, 1.51);
  if (!arms || !legs) return null;

  return {
    leftArm: arms.negative,
    rightArm: arms.positive,
    leftLeg: legs.negative,
    rightLeg: legs.positive,
    geometries: [...arms.geometries, ...legs.geometries],
  };
}

function requestedAnimation(character: CharacterDefinition, moving: boolean, running: boolean, preview: boolean) {
  if (preview && character.animations.preview) return character.animations.preview;
  if (running && character.animations.run) return character.animations.run;
  return moving ? character.animations.walk : character.animations.idle;
}

function ModelCharacter({ character, moving = false, running = false, preview = false }: Props) {
  const asset = useGLTF(character.modelUrl as string);
  const { scene, bunnyLimbRig } = useMemo(() => {
    const instance = clone(asset.scene);
    if (character.source.creator === "Minimoku") selectCuteBunnyVariant(instance, character);
    instance.traverse((object) => {
      if (object instanceof Mesh) {
        if (character.source.creator === "Quaternius") {
          object.material = Array.isArray(object.material)
            ? object.material.map((material) => toneQuaterniusMaterial(material, character))
            : toneQuaterniusMaterial(object.material, character);
        } else if (character.source.creator === "Minimoku") {
          object.material = Array.isArray(object.material)
            ? object.material.map((material) => toneCuteBunnyMaterial(material, character))
            : toneCuteBunnyMaterial(object.material, character);
        }
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return {
      scene: instance,
      bunnyLimbRig: character.source.creator === "Minimoku"
        ? createCuteBunnyLimbRig(instance, character)
        : null,
    };
  }, [asset.scene, character]);
  const { actions } = useAnimations(asset.animations, scene);
  const requestedClip = requestedAnimation(character, moving, running, preview);
  const availableClips = useMemo(() => asset.animations.map((animation) => animation.name), [asset.animations]);
  const resolution = useMemo(
    () => resolveCharacterAnimationClip(availableClips, requestedClip, character.animations.idle),
    [availableClips, character.animations.idle, requestedClip],
  );
  const fallbackMotion = useRef<Group>(null);

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    if (bunnyLimbRig) {
      const gaitActive = moving || preview;
      const speed = preview ? 3.4 : running ? 9.5 : 6.5;
      const armAmplitude = gaitActive ? (preview ? 0.12 : running ? 0.48 : 0.3) : 0;
      const legAmplitude = gaitActive ? (preview ? 0.09 : running ? 0.34 : 0.22) : 0;
      const swing = Math.sin(time * speed);
      const armTarget = swing * armAmplitude;
      const legTarget = -swing * legAmplitude;
      bunnyLimbRig.leftArm.rotation.x = MathUtils.damp(bunnyLimbRig.leftArm.rotation.x, armTarget, 14, delta);
      bunnyLimbRig.rightArm.rotation.x = MathUtils.damp(bunnyLimbRig.rightArm.rotation.x, -armTarget, 14, delta);
      bunnyLimbRig.leftLeg.rotation.x = MathUtils.damp(bunnyLimbRig.leftLeg.rotation.x, legTarget, 14, delta);
      bunnyLimbRig.rightLeg.rotation.x = MathUtils.damp(bunnyLimbRig.rightLeg.rotation.x, -legTarget, 14, delta);
    }

    if (resolution.clip || !fallbackMotion.current) return;
    const speed = running ? 9.5 : 6.5;
    const targetY = moving
      ? Math.abs(Math.sin(time * speed)) * character.motionProfile.bob
      : Math.sin(time * 1.7) * character.motionProfile.idleBreath;
    const targetTilt = moving ? Math.sin(time * speed * 0.5) * 0.035 : Math.sin(time * 0.82) * 0.015;
    fallbackMotion.current.position.y = MathUtils.damp(fallbackMotion.current.position.y, targetY, 12, delta);
    fallbackMotion.current.rotation.z = MathUtils.damp(fallbackMotion.current.rotation.z, targetTilt, 10, delta);
    if (preview) fallbackMotion.current.rotation.y += delta * 0.075;
  });

  useEffect(() => () => {
    bunnyLimbRig?.geometries.forEach((geometry) => geometry.dispose());
  }, [bunnyLimbRig]);

  useEffect(() => {
    if (!resolution.missingRequested || (character.allowsStaticPose && availableClips.length === 0)) return;
    console.warn(
      `[character-animation] ${character.id} is missing '${resolution.requested}'. ${
        resolution.clip ? `Using declared idle '${resolution.clip}'.` : "Holding the bind pose."
      } Available clips: ${availableClips.join(", ") || "none"}.`,
    );
  }, [availableClips, character.allowsStaticPose, character.id, resolution]);

  useEffect(() => {
    if (!resolution.clip) return;
    const action = actions[resolution.clip];
    action?.reset().setLoop(LoopRepeat, Infinity).fadeIn(0.2).play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [actions, resolution.clip]);

  return (
    <group
      name={`character-${character.id}`}
      position={character.visual.positionOffset}
      rotation={character.visual.rotation}
      scale={character.visual.scale}
      userData={{
        characterId: character.id,
        assetCreator: character.source.creator,
        renderer: character.renderer,
        bodyFamily: character.bodyFamily,
        activeClip: resolution.clip,
        missingRequestedClip: resolution.missingRequested,
      }}
    >
      <group ref={fallbackMotion}>
        <primitive object={scene} dispose={null} />
      </group>
    </group>
  );
}

function RendererContractFallback({ character, ...props }: Props) {
  useEffect(() => {
    console.error(`[character-renderer] '${character.id}' declares the GLTF renderer without a modelUrl.`);
  }, [character.id]);
  return <ProceduralCharacter character={character} {...props} />;
}

export function CharacterRenderer(props: Props) {
  if (props.character.renderer === "gltf") {
    return props.character.modelUrl
      ? <ModelCharacter {...props} />
      : <RendererContractFallback {...props} />;
  }
  if (props.character.renderer === "biped-animal") return <BipedAnimalCharacter {...props} />;
  return <ProceduralCharacter {...props} />;
}
