import { domainToASCII } from "node:url";

import type { IDToken } from "openid-client";

import { GOOGLE_ISSUER, GOOGLE_LOGIN_CONFIGURATION_KEY } from "./config.ts";
import { hashProof } from "./crypto.ts";

const LEGACY_GOOGLE_ISSUER = "accounts.google.com";
const MAX_ASSERTION_AGE_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 2 * 60;

export class GoogleClaimsValidationError extends Error {
  override readonly name = "GoogleClaimsValidationError";
}

export class GoogleWorkspaceAccountRequiredError extends GoogleClaimsValidationError {
}

export interface VerifiedGoogleClaims {
  readonly issuer: typeof GOOGLE_ISSUER;
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly emailVerified: true;
  readonly hostedDomain: string;
  readonly issuedAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
  readonly audienceConfigurationKey: typeof GOOGLE_LOGIN_CONFIGURATION_KEY;
  readonly authorizedPartyConfigurationKey:
    | typeof GOOGLE_LOGIN_CONFIGURATION_KEY
    | null;
  readonly nonceHash: Uint8Array;
  readonly displayName: string | null;
  readonly pictureUrl: string | null;
}

function invalidClaims(): never {
  throw new GoogleClaimsValidationError("Google identity claims are invalid");
}

function requireBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return invalidClaims();
  }
  return value;
}

function requireEpochSeconds(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return invalidClaims();
  }
  return value;
}

function normalizeEmail(value: unknown): string {
  const normalized = requireBoundedString(value, 3, 254)
    .normalize("NFKC")
    .toLowerCase();
  if (
    normalized !== normalized.trim() ||
    !/^[^\s@]+@[^\s@]+$/u.test(normalized)
  ) {
    return invalidClaims();
  }
  return normalized;
}

function normalizeHostedDomain(value: unknown): string {
  const raw = requireBoundedString(value, 3, 253).toLowerCase();
  const normalized = domainToASCII(raw);
  if (
    normalized.length < 3 ||
    normalized.length > 253 ||
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    !normalized.includes(".") ||
    normalized.split(".").some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    )
  ) {
    return invalidClaims();
  }
  return normalized;
}

function optionalDisplayName(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return requireBoundedString(value, 1, 200).normalize("NFKC");
}

function optionalPictureUrl(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const raw = requireBoundedString(value, 1, 2048);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return invalidClaims();
    }
    return parsed.href;
  } catch {
    return invalidClaims();
  }
}

function verifyAudience(value: unknown, expectedClientId: string): void {
  if (value === expectedClientId) {
    return;
  }
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4 &&
    value.every((entry) => typeof entry === "string") &&
    value.includes(expectedClientId)
  ) {
    return;
  }
  invalidClaims();
}

export interface VerifyGoogleClaimsInput {
  readonly claims: IDToken;
  readonly expectedClientId: string;
  readonly expectedNonce: string;
  readonly nowEpochSeconds?: number;
}

export function verifyGoogleWorkspaceClaims(
  input: VerifyGoogleClaimsInput,
): VerifiedGoogleClaims {
  const { claims, expectedClientId, expectedNonce } = input;
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new TypeError("nowEpochSeconds is invalid");
  }
  if (claims.iss !== GOOGLE_ISSUER && claims.iss !== LEGACY_GOOGLE_ISSUER) {
    return invalidClaims();
  }
  verifyAudience(claims.aud, expectedClientId);
  if (claims.azp !== undefined && claims.azp !== expectedClientId) {
    return invalidClaims();
  }
  if (claims.nonce !== expectedNonce) {
    return invalidClaims();
  }
  if (claims.email_verified !== true) {
    return invalidClaims();
  }

  const issuedAt = requireEpochSeconds(claims.iat);
  const expiresAt = requireEpochSeconds(claims.exp);
  if (
    issuedAt > now + CLOCK_SKEW_SECONDS ||
    issuedAt < now - MAX_ASSERTION_AGE_SECONDS - CLOCK_SKEW_SECONDS ||
    expiresAt <= now - CLOCK_SKEW_SECONDS ||
    expiresAt <= issuedAt
  ) {
    return invalidClaims();
  }

  const providerSubject = requireBoundedString(claims.sub, 1, 255);
  const normalizedEmail = normalizeEmail(claims.email);
  if (claims.hd === undefined) {
    throw new GoogleWorkspaceAccountRequiredError(
      "A Google Workspace account is required",
    );
  }
  const hostedDomain = normalizeHostedDomain(claims.hd);

  return Object.freeze({
    issuer: GOOGLE_ISSUER,
    providerSubject,
    normalizedEmail,
    emailVerified: true,
    hostedDomain,
    issuedAtEpochSeconds: issuedAt,
    expiresAtEpochSeconds: expiresAt,
    audienceConfigurationKey: GOOGLE_LOGIN_CONFIGURATION_KEY,
    authorizedPartyConfigurationKey:
      claims.azp === undefined ? null : GOOGLE_LOGIN_CONFIGURATION_KEY,
    nonceHash: hashProof(expectedNonce),
    displayName: optionalDisplayName(claims.name),
    pictureUrl: optionalPictureUrl(claims.picture),
  });
}
