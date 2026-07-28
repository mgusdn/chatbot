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

function PigeonFace({ character }: { character: CharacterDefinition }) {
  return (
    <>
      <mesh castShadow position={[0, 0.02, 0.4]} scale={[0.21, 0.12, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial color="#d8ab58" roughness={0.88} flatShading />
      </mesh>
      <mesh castShadow position={[0, 0.45, -0.03]} scale={[0.92, 0.26, 0.84]}>
        <sphereGeometry args={[0.44, 16, 10]} />
        <meshStandardMaterial color="#efe3c6" roughness={0.96} flatShading />
      </mesh>
      <mesh position={[0, -0.48, 0.25]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.13, 0.13, 0.05]} />
        <meshStandardMaterial color={character.colors.accent} roughness={0.9} />
      </mesh>
    </>
  );
}

function DogFace({ character }: { character: CharacterDefinition }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          castShadow
          position={[side * 0.43, 0.03, -0.05]}
          rotation={[0.1, 0, side * 0.18]}
          scale={[0.5, 1.2, 0.42]}
        >
          <capsuleGeometry args={[0.2, 0.34, 6, 10]} />
          <meshStandardMaterial color={character.colors.hair} roughness={0.96} flatShading />
        </mesh>
      ))}
      <mesh position={[0, -0.12, 0.4]} scale={[0.5, 0.36, 0.5]}>
        <sphereGeometry args={[0.28, 14, 10]} />
        <meshStandardMaterial color={character.colors.accent} roughness={0.94} flatShading />
      </mesh>
      <mesh position={[0, -0.08, 0.57]} scale={[1, 0.72, 0.75]}>
        <sphereGeometry args={[0.085, 12, 8]} />
        <meshStandardMaterial color="#51433a" roughness={0.72} />
      </mesh>
      <group position={[0.03, 0.43, 0.02]} rotation={[0, 0, -0.2]}>
        <mesh position={[-0.08, 0, 0]} rotation={[0, 0, -0.5]}>
          <sphereGeometry args={[0.09, 10, 7]} />
          <meshStandardMaterial color="#e9d16d" roughness={0.95} flatShading />
        </mesh>
        <mesh position={[0.08, 0.02, 0]} rotation={[0, 0, 0.5]}>
          <sphereGeometry args={[0.09, 10, 7]} />
          <meshStandardMaterial color="#e9d16d" roughness={0.95} flatShading />
        </mesh>
      </group>
    </>
  );
}

function TigerFace({ character }: { character: CharacterDefinition }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.34, 0.34, 0]} rotation={[0, 0, side * -0.12]}>
          <mesh castShadow>
            <coneGeometry args={[0.21, 0.38, 4]} />
            <meshStandardMaterial color={character.colors.skin} roughness={0.94} flatShading />
          </mesh>
          <mesh position={[0, -0.015, 0.045]} scale={0.56}>
            <coneGeometry args={[0.2, 0.34, 4]} />
            <meshStandardMaterial color="#d7a9b6" roughness={0.95} flatShading />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -0.1, 0.43]} scale={[0.62, 0.42, 0.48]}>
        <sphereGeometry args={[0.28, 14, 10]} />
        <meshStandardMaterial color="#faf5e9" roughness={0.96} flatShading />
      </mesh>
      <mesh position={[0, -0.06, 0.58]} scale={[1, 0.7, 0.72]}>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshStandardMaterial color="#6b5266" roughness={0.7} />
      </mesh>
      {[-1, 1].flatMap((side) => [0.08, 0.23].map((y, index) => (
        <mesh key={`${side}-${index}`} position={[side * (0.18 + index * 0.06), y, 0.43]} rotation={[0, 0, side * -0.35]}>
          <boxGeometry args={[0.055, 0.22, 0.035]} />
          <meshStandardMaterial color={character.colors.accent} roughness={0.86} />
        </mesh>
      )))}
    </>
  );
}

export function BipedAnimalCharacter({ character, moving = false, running = false, preview = false }: Props) {
  const animated = useRef<Group>(null);
  const head = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const tail = useRef<Group>(null);

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    const speed = running ? 11 : 7.5;
    const amount = character.motionProfile.stride * (running ? 1.28 : 1);
    const stride = moving ? Math.sin(time * speed) * amount : Math.sin(time * 1.25) * 0.025;
    const damp = Math.min(1, delta * 12);
    if (leftArm.current) leftArm.current.rotation.x += (-stride - leftArm.current.rotation.x) * damp;
    if (rightArm.current) rightArm.current.rotation.x += (stride - rightArm.current.rotation.x) * damp;
    if (leftLeg.current) leftLeg.current.rotation.x += (stride - leftLeg.current.rotation.x) * damp;
    if (rightLeg.current) rightLeg.current.rotation.x += (-stride - rightLeg.current.rotation.x) * damp;
    if (animated.current) {
      animated.current.position.y = moving
        ? Math.abs(Math.sin(time * speed)) * character.motionProfile.bob
        : Math.sin(time * 1.7) * character.motionProfile.idleBreath;
      if (preview) animated.current.rotation.y += delta * 0.075;
    }
    if (head.current) head.current.rotation.z = Math.sin(time * 0.82) * (moving ? 0.025 : 0.045);
    if (tail.current) tail.current.rotation.y = Math.sin(time * (moving ? 5.2 : 1.7)) * 0.26;
    if (eyes.current) {
      const blink = Math.sin(time * 0.72) > 0.985 ? 0.12 : 1;
      eyes.current.scale.y = MathUtils.damp(eyes.current.scale.y, blink, 28, delta);
    }
  });

  const face = character.species === "pigeon"
    ? <PigeonFace character={character} />
    : character.species === "dog"
      ? <DogFace character={character} />
      : <TigerFace character={character} />;

  return (
    <group
      name={`character-${character.id}`}
      position={character.visual.positionOffset}
      rotation={character.visual.rotation}
      scale={character.visual.scale}
      userData={{ characterId: character.id, renderer: character.renderer, species: character.species }}
    >
      <group ref={animated}>
        <group position={[0, 1.03, 0]}>
          <mesh castShadow scale={[0.52, 0.63, 0.38]}>
            <sphereGeometry args={[0.68, 18, 12]} />
            <meshStandardMaterial color={character.colors.top} roughness={0.93} flatShading />
          </mesh>
          <mesh position={[0, 0.02, 0.28]} scale={[0.72, 0.78, 0.2]}>
            <sphereGeometry args={[0.42, 14, 9]} />
            <meshStandardMaterial color={character.colors.accent} roughness={0.94} flatShading />
          </mesh>
          {character.species === "pigeon" && (
            <>
              <mesh position={[0, 0.2, 0.36]}><boxGeometry args={[0.34, 0.06, 0.05]} /><meshStandardMaterial color="#ead5aa" /></mesh>
              <mesh position={[0, 0.1, 0.38]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.12, 0.12, 0.05]} /><meshStandardMaterial color={character.colors.accent} /></mesh>
            </>
          )}
        </group>

        <group ref={leftArm} position={[-0.43, 1.25, 0]}>
          <mesh castShadow position={[0, -0.27, 0]} rotation={[0, 0, -0.08]}>
            <capsuleGeometry args={[0.12, 0.42, 6, 10]} />
            <meshStandardMaterial color={character.species === "pigeon" ? character.colors.skin : character.colors.top} roughness={0.95} flatShading />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.43, 1.25, 0]}>
          <mesh castShadow position={[0, -0.27, 0]} rotation={[0, 0, 0.08]}>
            <capsuleGeometry args={[0.12, 0.42, 6, 10]} />
            <meshStandardMaterial color={character.species === "pigeon" ? character.colors.skin : character.colors.top} roughness={0.95} flatShading />
          </mesh>
        </group>

        <group ref={leftLeg} position={[-0.2, 0.62, 0]}>
          <mesh castShadow position={[0, -0.25, 0]}><capsuleGeometry args={[0.13, 0.28, 6, 10]} /><meshStandardMaterial color={character.colors.skin} roughness={0.94} flatShading /></mesh>
          <mesh castShadow position={[0, -0.48, 0.09]} scale={[1, 0.7, 1.42]}><sphereGeometry args={[0.17, 12, 8]} /><meshStandardMaterial color={character.colors.shoes} roughness={0.94} flatShading /></mesh>
        </group>
        <group ref={rightLeg} position={[0.2, 0.62, 0]}>
          <mesh castShadow position={[0, -0.25, 0]}><capsuleGeometry args={[0.13, 0.28, 6, 10]} /><meshStandardMaterial color={character.colors.skin} roughness={0.94} flatShading /></mesh>
          <mesh castShadow position={[0, -0.48, 0.09]} scale={[1, 0.7, 1.42]}><sphereGeometry args={[0.17, 12, 8]} /><meshStandardMaterial color={character.colors.shoes} roughness={0.94} flatShading /></mesh>
        </group>

        <group ref={tail} position={[0, 0.95, -0.35]}>
          <mesh castShadow position={[0, 0.04, -0.18]} rotation={[0.9, 0, 0]} scale={character.species === "tiger" ? [0.13, 0.55, 0.13] : [0.16, 0.34, 0.16]}>
            <capsuleGeometry args={[0.5, 0.8, 6, 10]} />
            <meshStandardMaterial color={character.colors.hair} roughness={0.96} flatShading />
          </mesh>
        </group>

        <group ref={head} position={[0, 1.79, 0]}>
          <mesh castShadow scale={[1, 1.02, 0.94]}>
            <sphereGeometry args={[0.48, 18, 12]} />
            <meshStandardMaterial color={character.colors.skin} roughness={0.94} flatShading />
          </mesh>
          <group ref={eyes}>
            {[-1, 1].map((side) => (
              <group key={side} position={[side * 0.17, 0.08, 0.43]}>
                <mesh scale={[1.15, 1.28, 0.55]}><sphereGeometry args={[0.07, 12, 8]} /><meshStandardMaterial color="#f7f3e9" roughness={0.8} /></mesh>
                <mesh position={[side * 0.012, -0.005, 0.048]} scale={[1, 1.16, 0.5]}><sphereGeometry args={[0.04, 10, 7]} /><meshStandardMaterial color="#323136" roughness={0.58} /></mesh>
              </group>
            ))}
          </group>
          {face}
        </group>
      </group>
    </group>
  );
}
