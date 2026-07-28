"use client";

export const GUESTBOOK_PLACE_EVENT = "pume:guestbook-place";

export function requestGuestbookPlacement() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GUESTBOOK_PLACE_EVENT));
}
