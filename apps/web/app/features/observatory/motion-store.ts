import { useSyncExternalStore } from "react";

/** The observatory's master motion switch: the header's 暂停动效 button and the deck share it. */
let moving = true;
const listeners = new Set<() => void>();

export function setMoving(next: boolean) {
  if (moving === next) return;
  moving = next;
  for (const fn of listeners) fn();
}

export function toggleMoving() {
  setMoving(!moving);
}

export function useMoving(): boolean {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => moving,
    () => true,
  );
}
