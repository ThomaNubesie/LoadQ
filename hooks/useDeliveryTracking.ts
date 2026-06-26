import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { startBackgroundTracking, stopBackgroundTracking } from "../services/backgroundLocation";
import { KolisAPI } from "../services/kolis";
import { QueueAPI } from "../services/queue";

// Single source of truth for the background-location task. It runs while the
// driver either holds a queue spot OR is carrying a parcel (the delivery
// drive), and stops once neither is true. This is what keeps tracking alive
// from joining the queue, through loading, and all the way through the
// delivery after the carrier leaves the queue — then stops when fully idle.
//
// Mounted once from the authenticated (app) layout. Re-checks on app
// foreground and on a slow timer, so a delivered parcel or ended entry stops
// tracking even if the driver leaves the app open on one screen.
export function useDeliveryTracking() {
  const reconcile = useCallback(async () => {
    try {
      const [carry, entry] = await Promise.all([
        KolisAPI.carrying().catch(() => []),
        QueueAPI.getMyEntry().catch(() => null),
      ]);
      // LoadQ owns tracking for parcels accepted here (accepted_via 'loadq' or
      // legacy null); 'kolis'-accepted parcels are tracked by the Kolis app.
      const carryingHere = (carry ?? []).some((p) => p.accepted_via !== "kolis");
      const shouldTrack = carryingHere || !!entry;
      if (shouldTrack) await startBackgroundTracking();
      else await stopBackgroundTracking();
    } catch {
      /* best effort — next tick retries */
    }
  }, []);

  useEffect(() => {
    reconcile();
    const iv = setInterval(reconcile, 120_000);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") reconcile();
    });
    return () => {
      clearInterval(iv);
      sub.remove();
    };
  }, [reconcile]);
}
