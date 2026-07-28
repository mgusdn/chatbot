"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils, type Group } from "three";
import type { CharacterDefinition } from "@/types/character";

type Props = {
  character: CharacterDefinition;
  moving?: boolean;
  running?: boolean;
  preview?: boolean;
};

const CURLS = [
  [-0.33, 1.02, 0.13], [-0.18, 1.13, 0.18], [0, 1.17, 0.18], [0.18, 1.13, 0.18],
  [0.33, 1.02, 0.13], [-0.36, 0.93, 0.02], [0.36, 0.93, 0.02], [0, 1.05, 0.37],
] as const;

export function ProceduralCharacter({ character, moving = false, running = false, preview = false }: Props) {
  const root = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const speed = running ? 12 : 8;

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    const stride = moving
      ? Math.sin(time * speed) * character.motionProfile.stride * (running ? 1.28 : 1)
      : Math.sin(time * 1.4) * 0.025;
    if (leftArm.current) leftArm.current.rotation.x += (-stride - leftArm.current.rotation.x) * Math.min(1, delta * 12);
    if (rightArm.current) rightArm.current.rotation.x += (stride - rightArm.current.rotation.x) * Math.min(1, delta * 12);
    if (leftLeg.current) leftLeg.current.rotation.x += (stride - leftLeg.current.rotation.x) * Math.min(1, delta * 14);
    if (rightLeg.current) rightLeg.current.rotation.x += (-stride - rightLeg.current.rotation.x) * Math.min(1, delta * 14);
    if (root.current) {
      root.current.position.y = moving
        ? Math.abs(Math.sin(time * speed)) * character.motionProfile.bob
        : Math.sin(time * 1.8) * character.motionProfile.idleBreath;
      if (preview) root.current.rotation.y += delta * 0.08;
    }
    if (eyes.current) {
      const blink = Math.sin(time * 0.69) > 0.986 ? 0.12 : 1;
      eyes.current.scale.y = MathUtils.damp(eyes.current.scale.y, blink, 30, delta);
    }
  });

  return (
    <group
      position={character.visual.positionOffset}
      rotation={character.visual.rotation}
      scale={character.visual.scale}
      name={`character-${character.id}`}
      userData={{ characterId: character.id, renderer: character.renderer, bodyFamily: character.bodyFamily }}
    >
      <group ref={root}>
        <group position={[0, 0.92, 0]}>
      <group position={[0, 0.06, 0]}>
        <mesh castShadow scale={[0.48, 0.55, 0.34]}>
          <sphereGeometry args={[0.7, 28, 20]} />
          <meshStandardMaterial color={character.colors.top} roughness={0.86} />
        </mesh>
        <mesh position={[0, 0.13, 0.29]} scale={[0.25, 0.34, 0.05]}>
          <sphereGeometry args={[0.62, 18, 14]} />
          <meshStandardMaterial color={character.colors.accent} roughness={0.9} />
        </mesh>
      </group>

      <group ref={leftArm} position={[-0.43, 0.22, 0]}>
        <mesh castShadow position={[0, -0.22, 0]} rotation={[0, 0, -0.1]}>
          <capsuleGeometry args={[0.11, 0.35, 8, 12]} />
          <meshStandardMaterial color={character.colors.top} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, -0.47, 0]}>
          <sphereGeometry args={[0.12, 16, 12]} />
          <meshStandardMaterial color={character.colors.skin} roughness={0.9} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.43, 0.22, 0]}>
        <mesh castShadow position={[0, -0.22, 0]} rotation={[0, 0, 0.1]}>
          <capsuleGeometry args={[0.11, 0.35, 8, 12]} />
          <meshStandardMaterial color={character.colors.top} roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, -0.47, 0]}>
          <sphereGeometry args={[0.12, 16, 12]} />
          <meshStandardMaterial color={character.colors.skin} roughness={0.9} />
        </mesh>
      </group>

      <group ref={leftLeg} position={[-0.2, -0.35, 0]}>
        <mesh castShadow position={[0, -0.21, 0]}>
          <capsuleGeometry args={[0.13, 0.27, 8, 12]} />
          <meshStandardMaterial color="#6f766f" roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, -0.43, 0.06]} scale={[1, 0.72, 1.35]}>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color={character.colors.shoes} roughness={0.92} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.2, -0.35, 0]}>
        <mesh castShadow position={[0, -0.21, 0]}>
          <capsuleGeometry args={[0.13, 0.27, 8, 12]} />
          <meshStandardMaterial color="#6f766f" roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, -0.43, 0.06]} scale={[1, 0.72, 1.35]}>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color={character.colors.shoes} roughness={0.92} />
        </mesh>
      </group>

      <group position={[0, 0.82, 0]}>
        <mesh castShadow scale={[1, 1.03, 0.94]}>
          <sphereGeometry args={[0.52, 32, 24]} />
          <meshStandardMaterial color={character.colors.skin} roughness={0.92} />
        </mesh>
        <group ref={eyes}>
          <mesh position={[-0.17, 0.06, 0.46]} scale={[1, 1.18, 0.65]}>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshStandardMaterial color="#2d2928" roughness={0.55} />
          </mesh>
          <mesh position={[0.17, 0.06, 0.46]} scale={[1, 1.18, 0.65]}>
            <sphereGeometry args={[0.055, 16, 12]} />
            <meshStandardMaterial color="#2d2928" roughness={0.55} />
          </mesh>
        </group>
        <mesh position={[-0.14, -0.11, 0.46]} scale={[1.2, 0.48, 0.45]}>
          <sphereGeometry args={[0.07, 14, 10]} />
          <meshStandardMaterial color="#dd8e7e" transparent opacity={0.55} />
        </mesh>
        <mesh position={[0.14, -0.11, 0.46]} scale={[1.2, 0.48, 0.45]}>
          <sphereGeometry args={[0.07, 14, 10]} />
          <meshStandardMaterial color="#dd8e7e" transparent opacity={0.55} />
        </mesh>
        <mesh position={[0, -0.04, 0.49]} scale={[0.75, 0.38, 0.4]}>
          <sphereGeometry args={[0.055, 14, 10]} />
          <meshStandardMaterial color="#a7655c" />
        </mesh>

        {character.hairStyle === "short" && (
          <>
            <mesh position={[0, 0.34, -0.02]} scale={[1.02, 0.46, 0.92]} castShadow>
              <sphereGeometry args={[0.51, 24, 16]} />
              <meshStandardMaterial color={character.colors.hair} roughness={0.96} />
            </mesh>
            <group position={[0.04, 0.63, 0]} rotation={[0, 0, -0.12]}>
              <mesh position={[-0.055, 0, 0]} rotation={[0, 0, -0.4]}>
                <sphereGeometry args={[0.055, 10, 8]} />
                <meshStandardMaterial color="#6d9b4e" />
              </mesh>
              <mesh position={[0.055, 0.02, 0]} rotation={[0, 0, 0.4]}>
                <sphereGeometry args={[0.055, 10, 8]} />
                <meshStandardMaterial color="#83ad5e" />
              </mesh>
            </group>
          </>
        )}
        {character.hairStyle === "bob" && (
          <>
            <mesh position={[0, 0.2, -0.03]} scale={[1.08, 0.9, 1]} castShadow>
              <sphereGeometry args={[0.52, 24, 18]} />
              <meshStandardMaterial color={character.colors.hair} roughness={0.96} />
            </mesh>
            <mesh position={[0, 0.14, 0.29]} scale={[0.94, 0.42, 0.3]}>
              <sphereGeometry args={[0.5, 20, 14]} />
              <meshStandardMaterial color={character.colors.skin} roughness={0.92} />
            </mesh>
          </>
        )}
        {character.hairStyle === "curl" && CURLS.map((position, index) => (
          <mesh key={index} position={position} castShadow>
            <sphereGeometry args={[0.17, 14, 10]} />
            <meshStandardMaterial color={character.colors.hair} roughness={0.98} />
          </mesh>
        ))}
          {character.id === "acorn" ? (
            <group position={[0.2, 0.57, 0.02]} rotation={[0, 0, -0.24]}>
              <mesh castShadow scale={[1.18, 0.64, 1]}>
                <sphereGeometry args={[0.2, 14, 9]} />
                <meshStandardMaterial color="#8d5b3f" roughness={0.98} flatShading />
              </mesh>
              <mesh position={[0, 0.16, 0]} rotation={[0, 0, 0.18]}>
                <capsuleGeometry args={[0.025, 0.1, 4, 6]} />
                <meshStandardMaterial color="#57754f" roughness={0.95} />
              </mesh>
            </group>
          ) : null}
        </group>
      </group>
    </group>
    </group>
  );
}
