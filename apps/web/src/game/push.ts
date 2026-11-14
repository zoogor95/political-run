/**
 * Push notifications on this device: a service worker (public/sw.js) and a push subscription the game's server sends
 * "your move" to, even when the game is closed. Where push isn't available (some browsers, or the game embedded in
 * another page) the tab's own notifications (notify.ts) still work while it's open.
 */
import { API_URL, ensureAccount, sessionToken } from "./cloud";

export const pushSupported = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window && window.isSecureContext && window.top === window;

/** Registers the service worker once, early, so a later "Notify me" is quick. Failures are quiet: push just stays off. */
export function registerServiceWorker(): void {
  if (!pushSupported()) return;
  navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => undefined);
}

const urlKey = (b64: string) => {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function send(method: "POST" | "DELETE", body: unknown) {
  const res = await fetch(`${API_URL}/api/push`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken()}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`push ${res.status}`);
}

/** Whether this device already gets pushes. */
export async function pushOn(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(await reg?.pushManager.getSubscription());
}

/**
 * Asks to notify, subscribes this device with the game's key, and tells the server. Returns false when the player says
 * no, or push isn't available here (the caller falls back to the tab's notifications).
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  if ((await Notification.requestPermission()) !== "granted") return false;
  try {
    await ensureAccount();
    const keyRes = await fetch(`${API_URL}/api/push/key`);
    if (!keyRes.ok) return false;
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    const reg = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI));
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(publicKey) }));
    await send("POST", sub.toJSON());
    return true;
  } catch {
    return false;
  }
}

/** Stops pushes to this device. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await send("DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
