/* loadq.ca — count the visit, remember what sent it, and how long it lasted.
 *
 * Two calls to the loadq-hit function: one when the page opens, one when it is left, carrying
 * the seconds spent. They are matched by a random id generated per PAGE VIEW — it is never
 * stored anywhere, never reused, and cannot link one visit to the next. Still no cookie, no
 * account, no IP (the function does not store one), and only the referrer's host.
 *
 * The leave call goes on visibilitychange, not unload: iOS Safari often kills a page without
 * ever firing unload, and a beacon sent on hide is the one that actually arrives.
 *
 * The tag rides in the link that was published: loadq.ca/tk and /fb redirect here with ?s=.
 * It is kept for the rest of the visit, so a click from TikTok that lands on the home page and
 * then opens /get is still credited to TikTok rather than counted as "direct".
 *
 * Failures are silent by design: a counter must never break the page it counts.
 */
(function () {
  try {
    var ENDPOINT = "https://kzjptcpjpwlxfofzhyku.supabase.co/functions/v1/loadq-hit";
    var q = new URLSearchParams(location.search);
    var tag = q.get("s") || q.get("utm_source");

    var KEY = "loadq_src";
    if (tag) { try { sessionStorage.setItem(KEY, tag); } catch (e) {} }
    else { try { tag = sessionStorage.getItem(KEY); } catch (e) {} }

    var visit = (crypto && crypto.randomUUID) ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
    var started = Date.now();
    var sent = false;

    function post(body) {
      var s = JSON.stringify(body);
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([s], { type: "application/json" }));
      else fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: s, keepalive: true });
    }

    post({
      v: visit,
      p: location.pathname.slice(0, 200),
      r: document.referrer || "",
      s: tag || "",
      m: q.get("utm_medium") || "",
      c: q.get("utm_campaign") || "",
      d: matchMedia("(max-width: 820px)").matches ? "phone" : "desktop"
    });

    // How long they stayed. Sent once, when the page is first hidden or closed.
    function leave() {
      if (sent) return;
      sent = true;
      var secs = Math.round((Date.now() - started) / 1000);
      if (secs < 1 || secs > 3600) return;      // a tab left open all day says nothing useful
      post({ v: visit, t: secs });
    }
    addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") leave(); });
    addEventListener("pagehide", leave);
  } catch (e) { /* never break the page */ }
})();
