export type VillagerNpcDefinition = {
  id: string;
  spriteUrl: string;
  spriteAlt: string;
  position: readonly [number, number, number];
  line: string;
};

/** How close the player needs to walk for a villager's speech bubble to appear. */
export const NPC_SPEECH_RADIUS = 2.2;

/** Sprite height in world units; width follows each image's natural aspect ratio. */
export const NPC_SPRITE_HEIGHT = 2.4;

/**
 * Fixed idle villagers scattered around the counseling house interior.
 * Positions are hand-picked open floor spots in each zone (see
 * constants/interiorLayout.ts) that clear furniture colliders.
 */
export const VILLAGER_NPCS: readonly VillagerNpcDefinition[] = [
  {
    id: "npc-1",
    spriteUrl: "/images/characters/npc-duck.png",
    spriteAlt: "오리 주민",
    position: [-3.5, 0, 6],
    line: "다들 왕사랑!",
  },
  {
    id: "npc-2",
    spriteUrl: "/images/characters/npc-girl.png",
    spriteAlt: "소녀 주민",
    // Left-center of the central-forum boulevard, clear of npc-dog to the
    // south-west and any furniture colliders.
    position: [-1.8, 0, 0],
    line: "당신을 좋아하지 않을 사람은 없어요.",
  },
  {
    id: "npc-3",
    spriteUrl: "/images/characters/npc-dog.png",
    spriteAlt: "기타 치는 강아지 주민",
    position: [-3, 0, -2.5],
    line: "프메는 2021년 5월 13일에 창립되었어요. 현재 (9기) 대표는 홍지연이고 부대표는 조현우래요.",
  },
  {
    id: "npc-4",
    spriteUrl: "/images/characters/npc-hamster.png",
    spriteAlt: "햄스터 주민",
    position: [3, 0, -0.5],
    line: "세상에 쉬운 것은 없지만 못할 것도 없잖아",
  },
  {
    id: "npc-5",
    spriteUrl: "/images/characters/npc-deer.png",
    spriteAlt: "사슴 주민",
    position: [1.5, 0, 7],
    line: "데모데이에 온 걸 환영해! 행복하게 즐기길!",
  },
] as const;
