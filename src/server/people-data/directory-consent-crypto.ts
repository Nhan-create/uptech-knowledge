import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROOF = /^[A-Za-z0-9_-]{43}$/u;
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/u;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const TEXT = /^[^\0]{1,512}$/u;
const COOKIE = /^1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{1,4096})\.([A-Za-z0-9_-]{22})$/u;
const MAX_FUTURE_MS = 15 * 60 * 1_000;

export interface DirectoryConsentCookiePayload {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly sessionId: string;
  readonly connectorId: string;
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly hostedDomain: string;
  readonly state: string;
  readonly nonce: string;
  readonly pkceVerifier: string;
  readonly expiresAt: Date;
}

interface DirectoryConsentCookieKey {
  readonly environmentId: string;
  readonly keyVersion: string;
  readonly key: Uint8Array;
}

interface DirectoryConsentCookieOpenKey extends DirectoryConsentCookieKey {
  readonly now: Date;
}

function associatedData(context: DirectoryConsentCookieKey): Buffer {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(context.environmentId) ||
    !/^[\x21-\x7e]{1,128}$/u.test(context.keyVersion) ||
    !(context.key instanceof Uint8Array) ||
    context.key.byteLength !== 32
  ) {
    throw new TypeError("Directory consent cookie key is invalid");
  }
  return Buffer.from(
    `${context.environmentId}\x1fGOOGLE_DIRECTORY_CONSENT_V1\x1f${context.keyVersion}`,
    "utf8",
  );
}

function validPayload(value: DirectoryConsentCookiePayload): boolean {
  return (
    UUID_V4.test(value.workspaceId) &&
    UUID_V4.test(value.identityId) &&
    UUID_V4.test(value.sessionId) &&
    UUID_V4.test(value.connectorId) &&
    TEXT.test(value.providerSubject) &&
    value.normalizedEmail === value.normalizedEmail.toLowerCase() &&
    EMAIL.test(value.normalizedEmail) &&
    value.hostedDomain === value.hostedDomain.toLowerCase() &&
    DOMAIN.test(value.hostedDomain) &&
    PROOF.test(value.state) &&
    PROOF.test(value.nonce) &&
    PKCE.test(value.pkceVerifier) &&
    value.expiresAt instanceof Date &&
    Number.isFinite(value.expiresAt.getTime())
  );
}

export function sealDirectoryConsentCookie(
  value: DirectoryConsentCookiePayload,
  context: DirectoryConsentCookieKey,
): string {
  if (!validPayload(value)) {
    throw new TypeError("Directory consent cookie payload is invalid");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", context.key, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(associatedData(context));
  const plaintext = Buffer.from(JSON.stringify({
    w: value.workspaceId,
    i: value.identityId,
    s: value.sessionId,
    c: value.connectorId,
    p: value.providerSubject,
    e: value.normalizedEmail,
    h: value.hostedDomain,
    state: value.state,
    nonce: value.nonce,
    pkce: value.pkceVerifier,
    exp: value.expiresAt.toISOString(),
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function openDirectoryConsentCookie(
  sealed: unknown,
  context: DirectoryConsentCookieOpenKey,
): DirectoryConsentCookiePayload | null {
  if (
    typeof sealed !== "string" ||
    sealed.length > 4_500 ||
    !(context.now instanceof Date) ||
    !Number.isFinite(context.now.getTime())
  ) return null;
  const match = sealed.match(COOKIE);
  if (match === null) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      context.key,
      Buffer.from(match[1]!, "base64url"),
      { authTagLength: 16 },
    );
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(Buffer.from(match[3]!, "base64url"));
    const decoded = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(match[2]!, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as Record<string, unknown>;
    const value: DirectoryConsentCookiePayload = Object.freeze({
      workspaceId: decoded.w as string,
      identityId: decoded.i as string,
      sessionId: decoded.s as string,
      connectorId: decoded.c as string,
      providerSubject: decoded.p as string,
      normalizedEmail: decoded.e as string,
      hostedDomain: decoded.h as string,
      state: decoded.state as string,
      nonce: decoded.nonce as string,
      pkceVerifier: decoded.pkce as string,
      expiresAt: new Date(decoded.exp as string),
    });
    const remaining = value.expiresAt.getTime() - context.now.getTime();
    return validPayload(value) && remaining > 0 && remaining <= MAX_FUTURE_MS
      ? value
      : null;
  } catch {
    return null;
  }
}
