"use client";

import { InteriorArchitecture, preloadInteriorTextures } from "./InteriorArchitecture";
import { preloadInteriorModels } from "./InteriorAsset";
import { InteriorRooms } from "./InteriorRooms";

export function preloadInteriorScene() {
  preloadInteriorModels();
  preloadInteriorTextures();
}

export function InteriorScene() {
  return (
    <>
      <color attach="background" args={["#9c9185"]} />
      <fog attach="fog" args={["#9c9185", 23, 40]} />
      <ambientLight intensity={1.08} />
      <hemisphereLight args={["#f7eed7", "#56615c", 1.28]} />
      <directionalLight
        castShadow
        position={[-7, 12, 8]}
        intensity={2.05}
        color="#fff0cd"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={34}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <pointLight position={[0, 3.8, 1.1]} color="#ffd697" intensity={4.6} distance={16} decay={2} />
      <pointLight position={[0, 3.1, -5.45]} color="#e8d6a6" intensity={2.4} distance={8} decay={2} />
      <InteriorArchitecture />
      <InteriorRooms />
    </>
  );
}
