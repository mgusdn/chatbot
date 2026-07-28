"use client";

import { useCallback, useState } from "react";
import {
  DEFAULT_MEMORY_PLACEMENT,
  clampMemoryPlacement,
  type MemoryPlacementInput,
  type MemorySurfaceId,
} from "@/types/memoryRoom";

export type MemoryPlacementController = {
  active: boolean;
  value: MemoryPlacementInput;
  begin: (placement?: Partial<MemoryPlacementInput>) => void;
  update: (placement: Partial<MemoryPlacementInput>) => void;
  placeOnSurface: (surfaceId: MemorySurfaceId, u: number, v: number) => void;
  finish: () => MemoryPlacementInput;
  cancel: () => void;
  reset: () => void;
};

export function useMemoryPlacement(initial: MemoryPlacementInput = DEFAULT_MEMORY_PLACEMENT): MemoryPlacementController {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState(() => clampMemoryPlacement(initial));

  const begin = useCallback((placement: Partial<MemoryPlacementInput> = {}) => {
    setValue((current) => clampMemoryPlacement({ ...current, ...placement }));
    setActive(true);
  }, []);

  const update = useCallback((placement: Partial<MemoryPlacementInput>) => {
    setValue((current) => clampMemoryPlacement({ ...current, ...placement }));
  }, []);

  const placeOnSurface = useCallback((surfaceId: MemorySurfaceId, u: number, v: number) => {
    setValue((current) => clampMemoryPlacement({ ...current, surface_id: surfaceId, u, v }));
  }, []);

  const finish = useCallback(() => {
    setActive(false);
    return value;
  }, [value]);

  const cancel = useCallback(() => setActive(false), []);
  const reset = useCallback(() => {
    setValue(clampMemoryPlacement(initial));
    setActive(false);
  }, [initial]);

  return { active, value, begin, update, placeOnSurface, finish, cancel, reset };
}
