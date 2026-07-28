"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";

export type PbaoAnimation =
  | "idle"
  | "greet"
  | "listen"
  | "talk"
  | "nod"
  | "reassure"
  | "walk"
  | "run"
  | "dance"
  | "gesture-positive";

export function PbaoModel({ animation = "idle" }: { animation?: PbaoAnimation }) {
  const root = useRef<Group>(null);
  const head = useRef<Group>(null);
  const leftEye = useRef<Mesh>(null);
  const rightEye = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const active = animation !== "listen";
    const lively = animation === "greet"
      || animation === "reassure"
      || animation === "dance"
      || animation === "gesture-positive";
    const moving = animation === "walk" || animation === "run";
    const nodding = animation === "talk" || animation === "nod";

    if (root.current) {
      root.current.scale.y = 1 + Math.sin(t * (moving ? 5.2 : 1.4)) * (moving ? 0.018 : 0.008);
      root.current.rotation.z = lively ? Math.sin(t * 2.4) * 0.035 : 0;
    }
    if (head.current) {
      head.current.rotation.y = active ? Math.sin(t * (lively ? 1.8 : 0.45)) * (lively ? 0.13 : 0.08) : 0;
      head.current.rotation.x = nodding ? Math.sin(t * 2.8) * 0.055 : 0;
    }

    const blink = Math.sin(t * 0.7) > 0.985 ? 0.12 : 1;
    if (leftEye.current) leftEye.current.scale.y = blink;
    if (rightEye.current) rightEye.current.scale.y = blink;
  });

  return (
    <group
      ref={root}
      name="pbao-npc"
      userData={{
        npcId: "pbao",
        assetCreator: "Prometheus Studio",
        assetPack: "Procedural Pbao v1",
        assetLicense: "Project-internal",
        renderer: "procedural-panda",
        locomotion: "stationary",
        activeClip: animation,
      }}
    >
      <mesh castShadow position={[0, 0.18, 0]} scale={[0.66, 0.72, 0.5]}>
        <sphereGeometry args={[0.9, 30, 22]} />
        <meshStandardMaterial color="#342f2c" roughness={0.98} />
      </mesh>
      <mesh castShadow position={[0, 0.2, 0.43]} scale={[0.61, 0.62, 0.24]}>
        <sphereGeometry args={[0.8, 28, 20]} />
        <meshStandardMaterial color="#70815a" roughness={0.92} />
      </mesh>
      <mesh position={[0.27, 0.3, 0.62]} rotation={[0, 0, -0.35]}>
        <sphereGeometry args={[0.075, 14, 10]} />
        <meshStandardMaterial color="#9bb66b" />
      </mesh>
      <mesh position={[0.3, 0.35, 0.62]} rotation={[0, 0, 0.7]} scale={[0.35, 1, 0.3]}>
        <sphereGeometry args={[0.09, 14, 10]} />
        <meshStandardMaterial color="#547440" />
      </mesh>

      <group ref={head} position={[0, 1.04, 0.02]}>
        <mesh castShadow>
          <sphereGeometry args={[0.66, 32, 24]} />
          <meshStandardMaterial color="#f2e7d2" roughness={0.96} />
        </mesh>
        <mesh castShadow position={[-0.45, 0.45, -0.02]}>
          <sphereGeometry args={[0.22, 18, 14]} />
          <meshStandardMaterial color="#302b28" roughness={0.98} />
        </mesh>
        <mesh castShadow position={[0.45, 0.45, -0.02]}>
          <sphereGeometry args={[0.22, 18, 14]} />
          <meshStandardMaterial color="#302b28" roughness={0.98} />
        </mesh>
        <mesh position={[-0.23, 0.08, 0.57]} rotation={[0, 0, -0.25]} scale={[1, 1.35, 0.45]}>
          <sphereGeometry args={[0.19, 18, 14]} />
          <meshStandardMaterial color="#342f2d" roughness={0.98} />
        </mesh>
        <mesh position={[0.23, 0.08, 0.57]} rotation={[0, 0, 0.25]} scale={[1, 1.35, 0.45]}>
          <sphereGeometry args={[0.19, 18, 14]} />
          <meshStandardMaterial color="#342f2d" roughness={0.98} />
        </mesh>
        <mesh ref={leftEye} position={[-0.2, 0.08, 0.7]} scale={[1, 1, 0.55]}>
          <sphereGeometry args={[0.065, 16, 12]} />
          <meshStandardMaterial color="#171414" roughness={0.4} />
        </mesh>
        <mesh ref={rightEye} position={[0.2, 0.08, 0.7]} scale={[1, 1, 0.55]}>
          <sphereGeometry args={[0.065, 16, 12]} />
          <meshStandardMaterial color="#171414" roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.11, 0.68]} scale={[1.2, 0.72, 0.55]}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshStandardMaterial color="#292321" roughness={0.65} />
        </mesh>
        <mesh position={[-0.38, -0.1, 0.52]} scale={[1.4, 0.55, 0.35]}>
          <sphereGeometry args={[0.1, 14, 10]} />
          <meshStandardMaterial color="#e9a097" transparent opacity={0.72} />
        </mesh>
        <mesh position={[0.38, -0.1, 0.52]} scale={[1.4, 0.55, 0.35]}>
          <sphereGeometry args={[0.1, 14, 10]} />
          <meshStandardMaterial color="#e9a097" transparent opacity={0.72} />
        </mesh>
      </group>
    </group>
  );
}
