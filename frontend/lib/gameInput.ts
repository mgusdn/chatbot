type KeyboardInput = Pick<KeyboardEvent, "code" | "key">;

const GAME_KEY_BY_CODE: Record<string, string> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  KeyE: "e",
  KeyQ: "q",
  KeyR: "r",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  ShiftLeft: "shift",
  ShiftRight: "shift",
  Space: " ",
};

export function resolveGameKey(input: KeyboardInput) {
  return GAME_KEY_BY_CODE[input.code] ?? input.key.toLowerCase();
}
