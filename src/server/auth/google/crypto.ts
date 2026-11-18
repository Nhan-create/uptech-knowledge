import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";

import {
  GOOGLE_LOGIN_CONFIGURATION_KEY,
  GOOGLE_LOGIN_PURPOSE,
} from "./config.ts";

const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const SHA256_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;

export const LOGIN_TRANSACTION_COOKIE_NAME = "__Host-uptech_login_tx";
export const ONBOARDING_COOKIE_NAME = "__Host-uptech_onboarding";

export class GoogleLoginCryptoError extends Error {
  override readonly name = "GoogleLoginCryptoError";
}

function requireKey(key: Uint8Array, label: string): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new GoogleLoginCryptoError(`${label} is invalid`);
  }
  return Buffer.from(key);
}

export function issueOpaqueProof(): string {
  return randomBytes(SHA256_BYTES).toString("base64url");
}

export function isCanonicalProof(value: unknown): value is string {
  if (typeof value !== "string" || !PROOF_PATTERN.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return (
    decoded.byteLength === SHA256_BYTES && decoded.toString("base64url") === value
  );
}

export function hashProof(value: string): Uint8Array {
  if (!isCanonicalProof(value)) {
    throw new GoogleLoginCryptoError("Proof is invalid");
  }
  return createHash("sha256").update(value, "utf8").digest();
}

export function hashTextProof(value: string): Uint8Array {
  if (value.length < 1 || value.length > 512 || value.includes("\0")) {
    throw new GoogleLoginCryptoError("Text proof is invalid");
  }
  return createHash("sha256").update(value, "utf8").digest();
}

export function proofHashMatches(
  value: string,
  expectedHash: Uint8Array,
): boolean {
  if (!(expectedHash instanceof Uint8Array) || expectedHash.byteLength !== 32) {
    return false;
  }
  let actual: Uint8Array;
  try {
    actual = hashProof(value);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expectedHash));
}

export function deriveCsrfCredential(
  rawSessionCredential: string,
  sessionPepper: Uint8Array,
): string {
  if (!isCanonicalProof(rawSessionCredential)) {
    throw new GoogleLoginCryptoError("Session credential is invalid");
  }
  return createHmac("sha256", requireKey(sessionPepper, "Session pepper"))
    .update("uptech:web-session:csrf:v1\0", "utf8")
    .update(rawSessionCredential, "utf8")
    .digest("base64url");
}

export function canonicalizeClientIp(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (
    candidate.length < 2 ||
    candidate.length > 64 ||
    candidate.includes(",") ||
    candidate.includes("%")
  ) {
    throw new GoogleLoginCryptoError("Client network address is invalid");
  }

  if (candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) {
    return candidate.slice(7);
  }
  if (isIP(candidate) === 4) {
    return candidate;
  }
  if (isIP(candidate) === 6) {
    try {
      const hostname = new URL(`http://[${candidate}]/`).hostname;
      if (!hostname.startsWith("[") || !hostname.endsWith("]")) {
        throw new Error("non-canonical IPv6 hostname");
      }
      return hostname.slice(1, -1);
    } catch {
      throw new GoogleLoginCryptoError("Client network address is invalid");
    }
  }
  throw new GoogleLoginCryptoError("Client network address is invalid");
}

export function clientNetworkHmac(
  canonicalIp: string,
  environmentRateKey: Uint8Array,
): Uint8Array {
  const safeIp = canonicalizeClientIp(canonicalIp);
  return createHmac(
    "sha256",
    requireKey(environmentRateKey, "Environment rate key"),
  )
    .update("uptech:google-auth:network:v1\0", "utf8")
    .update(safeIp, "ascii")
    .digest();
}

export function trustedVercelClientIp(
  headers: Headers,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (environment.VERCEL !== "1") {
    if (
      environment.NODE_ENV === "development" &&
      environment.UPTECH_LOCAL_DEV_IP
    ) {
      return canonicalizeClientIp(environment.UPTECH_LOCAL_DEV_IP);
    }
    throw new GoogleLoginCryptoError("Trusted edge is unavailable");
  }
  const vercelId = headers.get("x-vercel-id");
  const forwarded = headers.get("x-vercel-forwarded-for");
  if (
    vercelId === null ||
    vercelId.length < 3 ||
    vercelId.length > 256 ||
    forwarded === null
  ) {
    throw new GoogleLoginCryptoError("Trusted edge headers are unavailable");
  }
  return canonicalizeClientIp(forwarded);
}

export interface LoginTransactionCookie {
  readonly browserCredential: string;
  readonly nonce: string;
}

export function encodeLoginTransactionCookie(
  value: LoginTransactionCookie,
): string {
  if (
    !isCanonicalProof(value.browserCredential) ||
    !isCanonicalProof(value.nonce)
  ) {
    throw new GoogleLoginCryptoError("Login transaction cookie is invalid");
  }
  return `${value.browserCredential}.${value.nonce}`;
}

export function decodeLoginTransactionCookie(
  value: string | null | undefined,
): LoginTransactionCookie | null {
  if (typeof value !== "string" || value.length !== 87) {
    return null;
  }
  const [browserCredential, nonce, extra] = value.split(".");
  if (
    extra !== undefined ||
    !isCanonicalProof(browserCredential) ||
    !isCanonicalProof(nonce)
  ) {
    return null;
  }
  return Object.freeze({ browserCredential, nonce });
}

export function pkceAssociatedData(input: {
  readonly environmentId: string;
  readonly locatorHash: Uint8Array;
}): Buffer {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.environmentId) ||
    !(input.locatorHash instanceof Uint8Array) ||
    input.locatorHash.byteLength !== 32
  ) {
    throw new GoogleLoginCryptoError("PKCE associated data is invalid");
  }

  return Buffer.from(
    `${input.environmentId}\x1f${GOOGLE_LOGIN_PURPOSE}\x1f${GOOGLE_LOGIN_CONFIGURATION_KEY}\x1f${Buffer.from(input.locatorHash).toString("hex")}`,
    "utf8",
  );
}

export interface PkceEnvelopeContext {
  readonly environmentId: string;
  readonly locatorHash: Uint8Array;
  readonly keyVersion: string;
  readonly key: Uint8Array;
}

export interface WebPkceEnvelope {
  readonly envelopeVersion: 1;
  readonly algorithm: "AES-256-GCM";
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly tag: Uint8Array;
}

export function encryptPkceVerifier(
  verifier: string,
  context: PkceEnvelopeContext,
): WebPkceEnvelope {
  if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
    throw new GoogleLoginCryptoError("PKCE verifier is invalid");
  }
  if (!/^[\x21-\x7e]{1,128}$/u.test(context.keyVersion)) {
    throw new GoogleLoginCryptoError("PKCE key version is invalid");
  }
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    requireKey(context.key, "PKCE encryption key"),
    nonce,
    { authTagLength: GCM_TAG_BYTES },
  );
  cipher.setAAD(pkceAssociatedData(context));
  const ciphertext = Buffer.concat([
    cipher.update(verifier, "ascii"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (
    nonce.byteLength + ciphertext.byteLength + tag.byteLength < 64 ||
    nonce.byteLength + ciphertext.byteLength + tag.byteLength > 256
  ) {
    throw new GoogleLoginCryptoError("PKCE envelope length is invalid");
  }
  return Object.freeze({
    envelopeVersion: ENVELOPE_VERSION,
    algorithm: "AES-256-GCM",
    nonce: Uint8Array.from(nonce),
    ciphertext: Uint8Array.from(ciphertext),
    tag: Uint8Array.from(tag),
  });
}

export function decryptPkceVerifier(
  envelope: WebPkceEnvelope,
  context: PkceEnvelopeContext,
  storedAssociatedData?: Uint8Array,
): string {
  if (!/^[\x21-\x7e]{1,128}$/u.test(context.keyVersion)) {
    throw new GoogleLoginCryptoError("PKCE key version is invalid");
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    envelope.envelopeVersion !== ENVELOPE_VERSION ||
    envelope.algorithm !== "AES-256-GCM" ||
    !(envelope.nonce instanceof Uint8Array) ||
    envelope.nonce.byteLength !== GCM_NONCE_BYTES ||
    !(envelope.ciphertext instanceof Uint8Array) ||
    envelope.ciphertext.byteLength < 36 ||
    envelope.ciphertext.byteLength > 228 ||
    !(envelope.tag instanceof Uint8Array) ||
    envelope.tag.byteLength !== GCM_TAG_BYTES ||
    envelope.nonce.byteLength +
        envelope.ciphertext.byteLength +
        envelope.tag.byteLength <
      64 ||
    envelope.nonce.byteLength +
        envelope.ciphertext.byteLength +
        envelope.tag.byteLength >
      256
  ) {
    throw new GoogleLoginCryptoError("PKCE envelope is invalid");
  }
  const associatedData = pkceAssociatedData(context);
  if (storedAssociatedData !== undefined) {
    if (
      !(storedAssociatedData instanceof Uint8Array) ||
      storedAssociatedData.byteLength !== associatedData.byteLength ||
      !timingSafeEqual(Buffer.from(storedAssociatedData), associatedData)
    ) {
      throw new GoogleLoginCryptoError("PKCE associated data is invalid");
    }
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      requireKey(context.key, "PKCE encryption key"),
      Buffer.from(envelope.nonce),
      { authTagLength: GCM_TAG_BYTES },
    );
    decipher.setAAD(associatedData);
    decipher.setAuthTag(Buffer.from(envelope.tag));
    const verifier = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext)),
      decipher.final(),
    ]).toString("ascii");
    if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
      throw new GoogleLoginCryptoError("PKCE verifier is invalid");
    }
    return verifier;
  } catch (error) {
    if (error instanceof GoogleLoginCryptoError) {
      throw error;
    }
    throw new GoogleLoginCryptoError("PKCE envelope authentication failed");
  }
}
