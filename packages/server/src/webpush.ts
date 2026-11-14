/**
 * Web Push from a Worker with nothing but WebCrypto: the message is encrypted for the browser that subscribed
 * (RFC 8291, "aes128gcm" content coding from RFC 8188) and the request is signed with the game's VAPID key (RFC 8292),
 * so any browser's push service (Google, Mozilla, Apple, Microsoft) delivers it.
 */

/** A browser's push subscription, as PushSubscription.toJSON() gives it. */
export interface PushTarget {
  endpoint: string;
  /** The browser's public key, base64url (65-byte uncompressed P-256 point). */
  p256dh: string;
  /** The browser's auth secret, base64url (16 bytes). */
  auth: string;
}

/** The game's VAPID key pair: the public key base64url (uncompressed point), the private key as its base64url "d". */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** Who's sending, for push services to reach: an https: or mailto: URL. */
  subject: string;
}

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** HKDF with SHA-256, for outputs of at most 32 bytes (one block), as Web Push needs. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** The P-256 public key as a JWK, from its uncompressed point. */
const publicJwk = (point: Uint8Array): JsonWebKey => ({ kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33, 65)), ext: true });

/**
 * Encrypts a message for one browser: a fresh key pair per message, a shared secret with the browser's key, keys
 * derived with its auth secret, then one AES-128-GCM record. Returns the request body.
 */
export async function encryptPayload(target: PushTarget, payload: Uint8Array, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array> {
  const uaPublic = unb64url(target.p256dh);
  const authSecret = unb64url(target.auth);
  const ua = await crypto.subtle.importKey("jwk", publicJwk(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256));

  // RFC 8291 §3.4: the input keying material, from the shared secret and the browser's auth secret.
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  // RFC 8188: the content key and nonce for the record.
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the message, then the delimiter that marks the last record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/** The VAPID Authorization header for a push service: a JWT signed with the game's key, and the public key. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const pub = unb64url(keys.publicKey);
  const signer = await crypto.subtle.importKey("jwk", { ...publicJwk(pub), d: keys.privateKey }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  // WebCrypto's ECDSA signature is already r || s, the form a JWT wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Sends one push message. Returns the push service's status: 201 delivered, 404/410 the subscription is gone. */
export async function sendPush(target: PushTarget, message: object, keys: VapidKeys, ttlSeconds = 86_400): Promise<number> {
  const body = await encryptPayload(target, enc.encode(JSON.stringify(message)));
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(target.endpoint, keys),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttlSeconds),
      urgency: "normal",
    },
    body,
  });
  return res.status;
}
