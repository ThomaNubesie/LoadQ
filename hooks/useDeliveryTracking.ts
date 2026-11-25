import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { startBackgroundTracking, stopBackgroundTracking } from "../services/backgroundLocation";
import { RaffleAPI } from "../services/raffle";
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
      const [carry, entry, raffle] = await Promise.all([
        KolisAPI.carrying().catch(() => []),
        QueueAPI.getMyEntry().catch(() => null),
        RaffleAPI.status().catch(() => null),
      ]);
      // LoadQ owns tracking for parcels accepted here (accepted_via 'loadq' or
      // legacy null); 'kolis'-accepted parcels are tracked by the Kolis app.
      const carryingHere = (carry ?? []).some((p) => p.accepted_via !== "kolis");
      // A driver who has checked into the morning raffle is at the lot and intends to
      // drive, but holds no queue entry until the draw (or until dispatch posts the
      // line). Without this they open the app at 05:2x, we decide not to track, they
      // pocket the phone — and nothing reports for the rest of the morning. That is
      // why a driver could leave without tapping Depart and still show a months-old
      // fix (Fabio, 2026-11-25). Bounded by the round phase, so it stops at close.
      const inRaffleWindow = !!raffle?.checked_in && raffle?.phase !== "closed" && raffle?.phase !== "none";
      const shouldTrack = carryingHere || !!entry || inRaffleWindow;
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
