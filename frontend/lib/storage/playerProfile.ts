import { isCharacterId } from "@/constants/characterCatalog";
import type { CharacterId, PlayerProfile } from "@/types/character";

export const PLAYER_PROFILE_KEY = "pume-village-player-profile";
export const MIGRATED_PROFILE_NICKNAME = "마음여행자";
export const NICKNAME_MAX_LENGTH = 10;

type StoredProfile = {
  schemaVersion?: unknown;
  characterId?: unknown;
  nickname?: unknown;
  selectedAt?: unknown;
};

export function normalizeNickname(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function validateNickname(value: string): string | null {
  const nickname = normalizeNickname(value);
  if (!nickname) return "닉네임을 입력해주세요.";
  if (Array.from(nickname).length > NICKNAME_MAX_LENGTH) return `닉네임은 ${NICKNAME_MAX_LENGTH}자까지 입력할 수 있어요.`;
  if (/[\u0000-\u001f\u007f<>]/u.test(nickname)) return "닉네임에 사용할 수 없는 문자가 있어요.";
  return null;
}

function selectedAtOrFallback(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : new Date(0).toISOString();
}

export function readPlayerProfile(storage: Pick<Storage, "getItem"> | undefined): PlayerProfile | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PLAYER_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfile;
    if (!isCharacterId(parsed.characterId)) return null;

    if (parsed.schemaVersion === 1) {
      return {
        schemaVersion: 2,
        characterId: parsed.characterId,
        nickname: MIGRATED_PROFILE_NICKNAME,
        selectedAt: selectedAtOrFallback(parsed.selectedAt),
      };
    }

    if (parsed.schemaVersion !== 2 || typeof parsed.nickname !== "string" || validateNickname(parsed.nickname)) return null;
    return {
      schemaVersion: 2,
      characterId: parsed.characterId,
      nickname: normalizeNickname(parsed.nickname),
      selectedAt: selectedAtOrFallback(parsed.selectedAt),
    };
  } catch {
    return null;
  }
}

export function writePlayerProfile(
  storage: Pick<Storage, "setItem"> | undefined,
  characterId: CharacterId,
  nickname = MIGRATED_PROFILE_NICKNAME,
) {
  const nicknameError = validateNickname(nickname);
  if (nicknameError) throw new Error(nicknameError);

  const profile: PlayerProfile = {
    schemaVersion: 2,
    characterId,
    nickname: normalizeNickname(nickname),
    selectedAt: new Date().toISOString(),
  };
  storage?.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile));
  return profile;
}
