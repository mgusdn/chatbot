export type CharacterAnimationResolution = {
  clip: string | null;
  requested: string;
  usedIdleFallback: boolean;
  missingRequested: boolean;
};

function findClip(availableClips: readonly string[], requested: string) {
  const exact = availableClips.find((clip) => clip === requested);
  if (exact) return exact;
  const normalized = requested.toLocaleLowerCase();
  return availableClips.find((clip) => clip.toLocaleLowerCase() === normalized) ?? null;
}

/**
 * Resolve an authored clip without ever selecting an unrelated animation.
 * A missing walk/run/preview may fall back to the declared idle clip; a
 * missing idle yields null so the renderer can hold the bind pose and report
 * the asset contract violation.
 */
export function resolveCharacterAnimationClip(
  availableClips: readonly string[],
  requested: string,
  declaredIdle: string,
): CharacterAnimationResolution {
  const requestedClip = findClip(availableClips, requested);
  if (requestedClip) {
    return { clip: requestedClip, requested, usedIdleFallback: false, missingRequested: false };
  }

  const idleClip = requested === declaredIdle ? null : findClip(availableClips, declaredIdle);
  return {
    clip: idleClip,
    requested,
    usedIdleFallback: Boolean(idleClip),
    missingRequested: true,
  };
}
