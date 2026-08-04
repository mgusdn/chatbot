"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Group, Vector3 } from "three";
import { CHARACTER_BY_ID } from "@/constants/characterCatalog";
import type { RemotePlayerState } from "@/types/multiplayer";
import { CharacterRenderer } from "./CharacterRenderer";

const POSITION_DAMPING = 14;
const ROTATION_DAMPING = 16;
const TELEPORT_DISTANCE_SQ = 16;

function shortestAngleDelta(current: number, target: number) {
  const fullTurn = Math.PI * 2;
  return ((target - current + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function RemotePlayer({ player }: { player: RemotePlayerState }) {
  const group = useRef<Group>(null);
  const targetPosition = useRef(new Vector3(...player.position));
  const targetRotationY = useRef(player.rotationY);

  useEffect(() => {
    targetPosition.current.set(...player.position);
    targetRotationY.current = player.rotationY;
  }, [player.position, player.rotationY]);

  useFrame((_, delta) => {
    if (!group.current) return;
    if (group.current.position.distanceToSquared(targetPosition.current) > TELEPORT_DISTANCE_SQ) {
      group.current.position.copy(targetPosition.current);
    } else {
      const alpha = 1 - Math.exp(-POSITION_DAMPING * delta);
      group.current.position.lerp(targetPosition.current, alpha);
    }
    const rotationAlpha = 1 - Math.exp(-ROTATION_DAMPING * delta);
    group.current.rotation.y += shortestAngleDelta(
      group.current.rotation.y,
      targetRotationY.current,
    ) * rotationAlpha;
  });

  const character = CHARACTER_BY_ID[player.characterId];
  return (
    <group
      ref={group}
      name={`remote-player-${player.playerId}`}
      position={player.position}
      rotation={[0, player.rotationY, 0]}
      userData={{
        playerId: player.playerId,
        connectionId: player.connectionId,
        nickname: player.nickname,
        remotePlayer: true,
      }}
    >
      <CharacterRenderer
        character={character}
        moving={player.moving}
        running={player.running}
      />
    </group>
  );
}

export function RemotePlayers({ players }: { players: RemotePlayerState[] }) {
  return (
    <group name="remote-players" userData={{ count: players.length }}>
      {players.map((player) => <RemotePlayer key={player.playerId} player={player} />)}
    </group>
  );
}
