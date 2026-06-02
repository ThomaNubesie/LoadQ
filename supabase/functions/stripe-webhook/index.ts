// Stripe webhook handler.
// Receives events from Stripe (configured at dashboard.stripe.com →
// Developers → Webhooks → add endpoint pointing to this function's URL).
// Verifies the Stripe signature, then updates the drivers row for the
// affected customer. Single source of truth for subscription status when
// the app is using the external web-checkout flow.
//
// Required event subscriptions on the Stripe webhook endpoint:
//   - checkout.session.completed    → upserts stripe_customer_id +
//                                     subscription_id on the driver row,
//                                     flips status to 'active', sets
//                                     subscription_ends_at = current period
//                                     end (Stripe trial included).
//   - invoice.paid                  → extends subscription_ends_at to the
//                                     newly-billed period end.
//   - customer.subscription.updated → catches plan switches and trial
//                                     ends; refreshes status + end date.
//   - customer.subscription.deleted → status='cancelled', keeps
//                                     subscription_ends_at so the driver
//                                     retains access through the period.
//
// Required env vars (set via `supabase secrets set` in CLI):
//   STRIPE_SECRET_KEY        - sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET    - whsec_... (from the Stripe webhook endpoint)
//   SUPABASE_URL             - injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY- injected by Supabase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY         = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET     = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia",
  httpClient:  Stripe.createFetchHttpClient(),
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// driver_id is passed through the Checkout Session's client_reference_id
// (set by the loadq.ca/subscribe page). For subsequent events that don't
// include client_reference_id (renewals, cancellations), we look the row
// up by stripe_customer_id which we stored on checkout.session.completed.
async function findDriverByCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from("drivers")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const driverId   = session.client_reference_id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subId      = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!driverId || !customerId || !subId) return;

  // Pull the subscription to get the current period end (covers trial too).
  const sub = await stripe.subscriptions.retrieve(subId);
  const periodEndIso = new Date(sub.current_period_end * 1000).toISOString();
  const isTrialing   = sub.status === "trialing";

  await supabase.from("drivers").update({
    stripe_customer_id:     customerId,
    stripe_subscription_id: subId,
    subscription_status:    isTrialing ? "trialing" : "active",
    subscription_ends_at:   periodEndIso,
    trial_ends_at:          sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  }).eq("id", driverId);
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const driverId   = await findDriverByCustomer(customerId);
  if (!driverId) return;

  let status: "active" | "trialing" | "expired" | "cancelled";
  if      (sub.status === "trialing")            status = "trialing";
  else if (sub.status === "active")              status = "active";
  else if (sub.status === "canceled")            status = "cancelled";
  else                                           status = "expired";

  await supabase.from("drivers").update({
    subscription_status:  status,
    subscription_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
    trial_ends_at:        sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  }).eq("id", driverId);
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const subId      = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!customerId || !subId) return;
  const driverId = await findDriverByCustomer(customerId);
  if (!driverId) return;

  // Refresh subscription to get the new period end after this invoice.
  const sub = await stripe.subscriptions.retrieve(subId);
  await supabase.from("drivers").update({
    subscription_status:  "active",
    subscription_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
  }).eq("id", driverId);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const driverId   = await findDriverByCustomer(customerId);
  if (!driverId) return;

  // Keep subscription_ends_at intact — the driver paid for the period
  // and should keep access until it ends. Status flip alone signals to
  // the renewal job not to expect another invoice.
  await supabase.from("drivers").update({
    subscription_status: "cancelled",
  }).eq("id", driverId);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature", { status: 400 });

  // raw body is required for signature verification.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Signature verification failed:", (e as Error).message);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // Ignore other event types. Returning 200 prevents Stripe from
        // retrying events we don't care about.
        break;
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook handler error:", (e as Error).message);
    // Return 500 so Stripe retries — handler bugs should not silently drop events.
    return new Response("Handler error", { status: 500 });
  }
});
