"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import { CHARACTER_BY_ID } from "@/constants/characterCatalog";
import type { CharacterId } from "@/types/character";
import { CharacterRenderer } from "./CharacterRenderer";

function PreviewAccents() {
  const accents = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!accents.current) return;
    accents.current.rotation.y = clock.elapsedTime * 0.08;
  });

  return (
    <group ref={accents} position={[0, 0.1, 0]}>
      <mesh position={[-1.38, 0.44, 0.05]} rotation={[0.2, 0.3, -0.6]}>
        <sphereGeometry args={[0.1, 12, 8]} />
        <meshStandardMaterial color="#f0d473" roughness={0.8} />
      </mesh>
      <mesh position={[1.45, 0.74, -0.1]} rotation={[-0.2, 0.1, 0.5]} scale={[0.65, 1.4, 0.5]}>
        <sphereGeometry args={[0.11, 12, 8]} />
        <meshStandardMaterial color="#89a970" roughness={0.86} />
      </mesh>
      <mesh position={[-1.62, 1.25, -0.45]} scale={0.65}>
        <octahedronGeometry args={[0.08, 0]} />
        <meshBasicMaterial color="#fff1a8" />
      </mesh>
    </group>
  );
}

export function CharacterPreviewScene({ characterId }: { characterId: CharacterId }) {
  const camera = useThree((state) => state.camera);
  const character = CHARACTER_BY_ID[characterId];
  const targetHeight = character.visual.previewTargetHeight;

  useEffect(() => {
    camera.position.set(0, targetHeight + 0.96, 5.55);
    camera.lookAt(0, targetHeight, 0);
    camera.updateProjectionMatrix();
  }, [camera, characterId, targetHeight]);

  return (
    <>
      <color attach="background" args={["#cdddbf"]} />
      <fog attach="fog" args={["#dce6ce", 7.5, 15]} />
      <ambientLight intensity={1.35} />
      <hemisphereLight args={["#fff9db", "#718667", 1.45]} />
      <directionalLight castShadow position={[4, 7, 5]} intensity={2.2} color="#fff0c4" shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-3, 2.8, 3]} intensity={0.55} color="#d7edc4" />

      <mesh receiveShadow position={[0, -0.06, 0]}>
        <cylinderGeometry args={[1.48, 1.74, 0.18, 48]} />
        <meshStandardMaterial color="#b6cb9e" roughness={0.98} />
      </mesh>
      <mesh position={[0, 0.036, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.17, 1.29, 48]} />
        <meshBasicMaterial color="#f8efc8" transparent opacity={0.88} />
      </mesh>

      <group position={[0, 0.75, 0]}>
        <CharacterRenderer key={characterId} character={character} preview />
      </group>

      <PreviewAccents />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.34} scale={4.1} blur={2.2} far={3.2} color="#3c5140" />
      <OrbitControls
        makeDefault
        target={[0, targetHeight, 0]}
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 2.75}
        maxPolarAngle={Math.PI / 2.05}
        minAzimuthAngle={-Math.PI * 0.78}
        maxAzimuthAngle={Math.PI * 0.78}
        autoRotate={false}
        rotateSpeed={0.55}
      />
    </>
  );
}
