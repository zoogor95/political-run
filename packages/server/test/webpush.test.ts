import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
// http_ece is the encryption the Node web-push library uses: an independent check that browsers can read our messages.
import ece from "http_ece";
import { describe, expect, it } from "vitest";
import { b64url, encryptPayload, unb64url, vapidAuthorization } from "../src/webpush.js";

/** A browser's side of a subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, target: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } };
}

describe("web push", () => {
  it("encrypts a message only the subscribed browser can read (RFC 8291, aes128gcm)", async () => {
    const b = browser();
    const message = JSON.stringify({ title: "Majority Map", body: "Turn 3 is in. Your move!" });
    const body = await encryptPayload(b.target, new TextEncoder().encode(message));
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: b.ecdh, authSecret: b.auth });
    expect(plain.toString("utf8")).toBe(message);
    // Another browser's keys can't open it.
    const other = browser();
    expect(() => ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: other.ecdh, authSecret: other.auth })).toThrow();
  });

  it("signs the request with the game's VAPID key for the push service it goes to (RFC 8292)", async () => {
    const vapid = createECDH("prime256v1");
    vapid.generateKeys();
    const keys = { publicKey: b64url(vapid.getPublicKey()), privateKey: b64url(vapid.getPrivateKey()), subject: "https://majority-map.example" };
    const now = 1_800_000_000_000;
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(unb64url(m[2]!)).toString("utf8"));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "https://majority-map.example" });
    const pub = unb64url(keys.publicKey);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) }, format: "jwk" });
    const ok = verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(unb64url(m[3]!)));
    expect(ok).toBe(true);
  });
});
