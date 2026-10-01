export const iterations = 600000;
const encoder = new TextEncoder();

export function base64(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function unbase64(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

export async function passwordConfig(password, salt = base64(crypto.getRandomValues(new Uint8Array(16)))) {
  const hash = await derivePassword(password, salt);
  return { algorithm: "PBKDF2-SHA256", iterations, salt, hash: base64(hash) };
}

export async function derivePassword(password, salt, subtle = crypto.subtle) {
  const key = await subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unbase64(salt), iterations }, key, 256).catch((error) => {
    if (error.name !== "NotSupportedError") throw error;
    return portablePassword(password, salt);
  });
}

// Hosted Workers can cap native PBKDF2 iterations; local workerd does not enforce that cap.
// Compute the identical hash without changing existing credentials or weakening the iteration count.
export async function portablePassword(password, salt) {
  const { pbkdf2Async } = await import("@noble/hashes/pbkdf2.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  return pbkdf2Async(sha256, encoder.encode(password), unbase64(salt), { c: iterations, dkLen: 32 });
}

export async function verifyPassword(password, config) {
  if (!config || config.algorithm !== "PBKDF2-SHA256" || config.iterations !== iterations || typeof config.salt !== "string" || typeof config.hash !== "string") return false;
  const candidate = await passwordConfig(password, config.salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(candidate.hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return crypto.subtle.verify("HMAC", key, await crypto.subtle.sign("HMAC", key, encoder.encode(config.hash)), encoder.encode(candidate.hash));
}

export async function digest(text) {
  return base64(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function sessionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw Object.assign(new Error("尚未配置至少 32 字符的 SESSION_SECRET。"), { status: 503 });
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(payload, secret) {
  const content = base64(encoder.encode(JSON.stringify(payload)));
  return `${content}.${base64(await crypto.subtle.sign("HMAC", await sessionKey(secret), encoder.encode(content)))}`;
}

export async function readSession(token, secret) {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const valid = await crypto.subtle.verify("HMAC", await sessionKey(secret), unbase64(parts[1]), encoder.encode(parts[0]));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(unbase64(parts[0])));
  return payload.exp > Date.now() ? payload : null;
}
