/**
 * Telling a player it's their move while the game is in another tab: the tab's title, and a browser notification if
 * they've allowed them. (Notifications to a closed game, through the phone stores and web push, come later.)
 */
const BASE_TITLE = typeof document !== "undefined" ? document.title : "Majority Map";

export const canNotify = () => typeof Notification !== "undefined";
export const notificationsOn = () => canNotify() && Notification.permission === "granted";

export async function askToNotify(): Promise<boolean> {
  if (!canNotify()) return false;
  return (await Notification.requestPermission()) === "granted";
}

/** Shows the message if the game isn't on screen; the title keeps a mark until the player comes back. */
export function nudge(message: string) {
  if (typeof document === "undefined" || !document.hidden) return;
  document.title = `● ${message} · ${BASE_TITLE}`;
  if (notificationsOn()) {
    try {
      const n = new Notification("Majority Map", { body: message, tag: "majority-map-turn" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some browsers only allow notifications from a service worker; the title still shows it.
    }
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) document.title = BASE_TITLE;
  });
}
