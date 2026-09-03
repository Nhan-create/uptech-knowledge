import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROOF = /^[A-Za-z0-9_-]{43}$/u;
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/u;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const TEXT = /^[^\0]{1,512}$/u;
const COOKIE = /^1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{1,4096})\.([A-Za-z0-9_-]{22})$/u;
const MAX_FUTURE_MS = 10 * 60 * 1_000;

export const GOOGLE_WORKSPACE_SETUP_COOKIE_NAME = "__Host-uptech_workspace_setup_tx";

export interface GoogleWorkspaceSetupCookiePayload {
  readonly attemptId: string;
  readonly candidateWorkspaceId: string;
  readonly identityId: string;
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly hostedDomain: string;
  readonly state: string;
  readonly nonce: string;
  readonly pkceVerifier: string;
  readonly expiresAt: Date;
}

export interface SetupCookieKey {
  readonly environmentId: string;
  readonly keyVersion: string;
  readonly key: Uint8Array;
}

export interface SetupCookieOpenKey extends SetupCookieKey {
  readonly now: Date;
}

function aad(context: SetupCookieKey): Buffer {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(context.environmentId) ||
      !/^[\x21-\x7e]{1,128}$/u.test(context.keyVersion) ||
      !(context.key instanceof Uint8Array) || context.key.byteLength !== 32) {
    throw new TypeError("Google Workspace setup cookie key is invalid");
  }
  return Buffer.from(`${context.environmentId}\x1fGOOGLE_WORKSPACE_TENANT_BOOTSTRAP_V1\x1f${context.keyVersion}`, "utf8");
}

function canonicalDomain(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 && value === value.toLowerCase() &&
    domainToASCII(value) === value && DOMAIN.test(value);
}

function valid(value: GoogleWorkspaceSetupCookiePayload): boolean {
  return UUID_V4.test(value.attemptId) && UUID_V4.test(value.candidateWorkspaceId) &&
    UUID_V4.test(value.identityId) && TEXT.test(value.providerSubject) &&
    typeof value.normalizedEmail === "string" && value.normalizedEmail === value.normalizedEmail.toLowerCase() &&
    value.normalizedEmail.length <= 320 && EMAIL.test(value.normalizedEmail) &&
    canonicalDomain(value.hostedDomain) && value.normalizedEmail.endsWith(`@${value.hostedDomain}`) &&
    PROOF.test(value.state) && PROOF.test(value.nonce) && PKCE.test(value.pkceVerifier) &&
    value.expiresAt instanceof Date && Number.isFinite(value.expiresAt.getTime());
}

export function sealGoogleWorkspaceSetupCookie(value: GoogleWorkspaceSetupCookiePayload, key: SetupCookieKey): string {
  if (typeof value !== "object" || value === null || !valid(value)) {
    throw new TypeError("Google Workspace setup cookie payload is invalid");
  }
  const associatedData = aad(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce, { authTagLength: 16 });
  cipher.setAAD(associatedData);
  const plaintext = Buffer.from(JSON.stringify({
    a: value.attemptId, w: value.candidateWorkspaceId, i: value.identityId,
    p: value.providerSubject, e: value.normalizedEmail, h: value.hostedDomain,
    s: value.state, n: value.nonce, k: value.pkceVerifier, x: value.expiresAt.toISOString(),
  }), "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  } finally {
    plaintext.fill(0);
  }
}

export function openGoogleWorkspaceSetupCookie(value: unknown, key: SetupCookieOpenKey): GoogleWorkspaceSetupCookiePayload | null {
  if (typeof value !== "string" || value.length > 4_500 || !(key.now instanceof Date) || !Number.isFinite(key.now.getTime())) return null;
  const match = COOKIE.exec(value);
  if (match === null) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(match[1]!, "base64url"), { authTagLength: 16 });
    decipher.setAAD(aad(key));
    decipher.setAuthTag(Buffer.from(match[3]!, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(match[2]!, "base64url")), decipher.final()]);
    let decoded: unknown;
    try { decoded = JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
    const record = decoded as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "a,e,h,i,k,n,p,s,w,x") return null;
    if (typeof record.x !== "string") return null;
    const expiresAt = new Date(record.x);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== record.x) return null;
    const result: GoogleWorkspaceSetupCookiePayload = Object.freeze({
      attemptId: record.a as string, candidateWorkspaceId: record.w as string,
      identityId: record.i as string, providerSubject: record.p as string,
      normalizedEmail: record.e as string, hostedDomain: record.h as string,
      state: record.s as string, nonce: record.n as string, pkceVerifier: record.k as string,
      expiresAt,
    });
    const remaining = result.expiresAt.getTime() - key.now.getTime();
    return valid(result) && remaining > 0 && remaining <= MAX_FUTURE_MS ? result : null;
  } catch { return null; }
}
