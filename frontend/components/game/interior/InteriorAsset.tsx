"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import { Box3, Vector3 } from "three";

type Props = {
  url: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  castShadow?: boolean;
};

/**
 * Kenney models use consistent units but their origins differ by asset. Clone
 * and ground-center each model so room placements stay predictable.
 */
export function InteriorAsset({ url, position, rotation = [0, 0, 0], scale = 2, castShadow = true }: Props) {
  const source = useGLTF(url).scene;
  const model = useMemo(() => {
    const clone = source.clone(true);
    const bounds = new Box3().setFromObject(clone);
    const center = bounds.getCenter(new Vector3());
    clone.position.set(-center.x, -bounds.min.y, -center.z);
    clone.traverse((node) => {
      if ("isMesh" in node && node.isMesh) {
        node.castShadow = castShadow;
        node.receiveShadow = true;
      }
    });
    return clone;
  }, [source, castShadow]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={model} />
    </group>
  );
}

const INTERIOR_MODEL_URLS = [
  "/models/kenney-furniture-kit/loungeSofa.glb",
  "/models/kenney-furniture-kit/bookcaseOpen.glb",
  "/models/kenney-furniture-kit/bookcaseOpenLow.glb",
  "/models/kenney-furniture-kit/bookcaseClosedDoors.glb",
  "/models/kenney-furniture-kit/chairRounded.glb",
  "/models/kenney-furniture-kit/chairCushion.glb",
  "/models/kenney-furniture-kit/benchCushion.glb",
  "/models/kenney-furniture-kit/tableRound.glb",
  "/models/kenney-furniture-kit/rugRounded.glb",
  "/models/kenney-furniture-kit/lampRoundFloor.glb",
  "/models/kenney-furniture-kit/lampRoundTable.glb",
  "/models/kenney-furniture-kit/pottedPlant.glb",
  "/models/kenney-furniture-kit/books.glb",
  "/models/kenney-food-kit/cup-tea.glb",
  "/models/kenney-food-kit/cup-saucer.glb",
  "/models/kenney-nature-kit/pot_small.glb",
  "/models/kenney-nature-kit/plant_flatTall.glb",
  "/models/kenney-nature-kit/crops_bambooStageB.glb",
  "/models/kenney-nature-kit/flower_yellowA.glb",
  "/models/kenney-nature-kit/rock_smallFlatA.glb",
];

export function preloadInteriorModels() {
  INTERIOR_MODEL_URLS.forEach((url) => useGLTF.preload(url));
}
