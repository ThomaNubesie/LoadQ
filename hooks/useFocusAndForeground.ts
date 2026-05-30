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
export function useFocusAndForeground(callback: () => void) {
  // Stash latest callback in a ref so the AppState listener doesn't capture
  // a stale closure if the caller's deps change between mounts.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useFocusEffect(useCallback(() => { cbRef.current(); }, []));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") cbRef.current();
    });
    return () => sub.remove();
  }, []);
}
