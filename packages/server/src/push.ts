/** Telling players it's their move when the game isn't open: their browsers' push subscriptions, and sending to them. */
import type { Env } from "./api.js";
import { sendPush, type PushTarget } from "./webpush.js";

/** The game's VAPID keys, when this deployment has them (the private key is a secret, set with `wrangler secret put`). */
export function vapidKeys(env: Env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.SITE_URL ?? "https://majority-map.example" };
}

/** What a device sends to subscribe: PushSubscription.toJSON(). Checked before it's stored. */
export function checkSubscription(b: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }): PushTarget | null {
  const endpoint = b.endpoint;
  const p256dh = b.keys?.p256dh;
  const auth = b.keys?.auth;
  if (typeof endpoint !== "string" || endpoint.length > 1000 || !/^https:\/\/[^\s]+$/.test(endpoint)) return null;
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh)) return null;
  if (typeof auth !== "string" || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/**
 * Sends a message to every device of these accounts. Subscriptions the push service says are gone (404, 410) are
 * deleted; any other failure is logged and the rest carry on.
 */
export async function notifyAccounts(env: Env, accountIds: string[], message: { title: string; body: string; url: string; tag: string }): Promise<number> {
  const keys = vapidKeys(env);
  if (!keys || accountIds.length === 0) return 0;
  const rows = await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account_id IN (${accountIds.map(() => "?").join(",")})`)
    .bind(...accountIds)
    .all<PushTarget>();
  let sent = 0;
  await Promise.all(
    rows.results.map(async (t) => {
      try {
        const status = await sendPush(t, message, keys);
        if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(t.endpoint).run();
        else if (status >= 200 && status < 300) sent++;
        else console.error("push", status, new URL(t.endpoint).host);
      } catch (e) {
        console.error("push", e);
      }
    }),
  );
  return sent;
}
