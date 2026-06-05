import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

// Run a callback when the screen comes into focus AND when the app returns
// from background to foreground. useFocusEffect alone misses the second
// case — if the user is already on this screen and just backgrounded the
// app, no focus event fires when they return. We need an AppState listener
// to cover that.
//
// Used to re-run GPS-based zone detection so drivers and passengers always
// land on their current physical zone whenever the app becomes interactive,
// not just when they manually navigate.
//
// `minIntervalMs` debounces the callback: focus and foreground both fire in
// quick succession (and on Android, returning from the permission dialog
// itself bounces AppState inactive→active), which otherwise re-runs an
// expensive GPS + network reload several times per interaction. Pass the
// GPS timeout (~8s) so a single user action triggers at most one detect.
export function useFocusAndForeground(callback: () => void, minIntervalMs = 0) {
  // Stash latest callback in a ref so the AppState listener doesn't capture
  // a stale closure if the caller's deps change between mounts.
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const lastRunRef = useRef(0);

  const run = useCallback(() => {
    if (minIntervalMs > 0) {
      const now = Date.now();
      if (now - lastRunRef.current < minIntervalMs) return;
      lastRunRef.current = now;
    }
    cbRef.current();
  }, [minIntervalMs]);

  useFocusEffect(useCallback(() => { run(); }, [run]));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => sub.remove();
  }, [run]);
}
