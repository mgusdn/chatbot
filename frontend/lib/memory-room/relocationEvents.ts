export const MEMORY_RELOCATION_COMMIT_EVENT = "pume:memory-relocation-commit";
export const MEMORY_RELOCATION_CANCEL_EVENT = "pume:memory-relocation-cancel";

function dispatch(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
}

export function requestMemoryRelocationCommit() {
  dispatch(MEMORY_RELOCATION_COMMIT_EVENT);
}

export function requestMemoryRelocationCancel() {
  dispatch(MEMORY_RELOCATION_CANCEL_EVENT);
}
