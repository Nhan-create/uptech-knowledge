import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";

import { inspectBrowserAuthority } from "../../auth/browser-authority.ts";
import { GOOGLE_ISSUER, loadGoogleLoginRuntimeConfig } from "../../auth/google/config.ts";
import {
  clientNetworkHmac,
  deriveCsrfCredential,
  hashProof,
  isCanonicalProof,
  ONBOARDING_COOKIE_NAME,
  trustedVercelClientIp,
} from "../../auth/google/crypto.ts";
import { clearedWebSessionCookie } from "../../auth/web-session.ts";
import { getRuntimeDatabasePool } from "../../db/runtime-pool.ts";
import { createSafeProblem, requestIdFromHeaders, type ProblemCode } from "../../http/problem.ts";
import { createGoogleDirectoryConsentProvider } from "../../people-data/google-directory-consent-provider.ts";
import { hasExactGoogleDirectoryReadOnlyScopes } from "../../people-data/google-directory-scopes.ts";
import type { SecretReference } from "../../secrets/core.ts";
import {
  issueSessionCredential,
  serializeWebSessionCookie,
  WEB_SESSION_COOKIE_NAME,
} from "../../sessions/session-security.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "./crypto.ts";
import { exactCsrfCredential } from "./http.ts";
import { formatVerifiedDomainsCompositeArray } from "./repository.ts";
import {
  createConfiguredGoogleWorkspaceBootstrapRuntime,
  createConfiguredSecretAdapter,
  GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH,
} from "./runtime.ts";

export const DIRECT_ORG_SIGNUP_COOKIE_NAME = "__Host-uptech_workspace_direct_tx";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MAX_FORM_BYTES = 96;
const MAX_COOKIE_VALUE_BYTES = 4_500;
const MAX_COOKIE_TTL_MS = 10 * 60 * 1_000;
const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const ENVELOPE_PATTERN = /^1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{1,4096})\.([A-Za-z0-9_-]{22})$/u;
const GOOGLE_AUTHORIZATION_ORIGIN = "https://accounts.google.com/o/oauth2/v2/auth";

const COMPLETE_DIRECT_SIGNUP_SQL = `SELECT result.outcome::text AS outcome,
  result.workspace_id::text AS workspace_id,
  result.identity_id::text AS identity_id,
  result.user_id::text AS user_id,
  result.membership_id::text AS membership_id,
  result.connector_id::text AS connector_id
FROM uptech.complete_direct_workspace_signup_v1(
  $1::text,$2::text,$3::text,$4::text,$5::uuid,$6::text,$7::text,
  $8::uptech.google_workspace_verified_domain_v1[],$9::text,$10::text[],$11::uuid
) AS result`;

const ISSUE_DIRECT_SESSION_SQL = `SELECT uptech.issue_direct_signup_web_session_v1(
  $1::uuid,$2::uuid,$3::uuid,$4::uuid,
  $5::uptech.google_auth_hash32_v1,$6::uptech.google_auth_hash32_v1,$7::uuid
) AS outcome`;

interface DirectSignupCookiePayload {
  readonly state: string;
  readonly nonce: string;
  readonly pkceVerifier: string;
  readonly expiresAt: Date;
}

function responseHeaders(requestId: string): Headers {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
}

function problemResponse(code: ProblemCode, requestId: string): Response {
  const document = createSafeProblem(code, requestId);
  const headers = responseHeaders(requestId);
  headers.set("Content-Type", "application/problem+json");
  return new Response(JSON.stringify(document), { status: document.status, headers });
}

function clearHostCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function clearDirectCookie(): string {
  return clearHostCookie(DIRECT_ORG_SIGNUP_COOKIE_NAME);
}

function setDirectCookie(value: string): string {
  return `${DIRECT_ORG_SIGNUP_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function cookieOccurrences(headers: Headers, name: string): readonly string[] | null {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return [];
  if (Buffer.byteLength(cookieHeader, "utf8") > 16_384) return null;
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_COOKIE_VALUE_BYTES) return null;
    values.push(value);
  }
  return values;
}

function aad(environmentId: string, keyVersion: string): Buffer {
  return Buffer.from(`${environmentId}\x1fUPTECH_DIRECT_ORG_SIGNUP_V1\x1f${keyVersion}`, "utf8");
}

function sealDirectCookie(
  payload: DirectSignupCookiePayload,
  key: Readonly<{ environmentId: string; keyVersion: string; key: Uint8Array }>,
): string {
  if (!PROOF_PATTERN.test(payload.state) || !PROOF_PATTERN.test(payload.nonce) || !PKCE_PATTERN.test(payload.pkceVerifier)) {
    throw new TypeError("Direct signup transaction payload is invalid");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad(key.environmentId, key.keyVersion));
  const plaintext = Buffer.from(JSON.stringify({
    s: payload.state,
    n: payload.nonce,
    k: payload.pkceVerifier,
    x: payload.expiresAt.toISOString(),
  }), "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  } finally {
    plaintext.fill(0);
  }
}

function openDirectCookie(
  value: unknown,
  key: Readonly<{ environmentId: string; keyVersion: string; key: Uint8Array; now: Date }>,
): DirectSignupCookiePayload | null {
  if (typeof value !== "string" || value.length > MAX_COOKIE_VALUE_BYTES) return null;
  const match = ENVELOPE_PATTERN.exec(value);
  if (match === null) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(match[1]!, "base64url"), { authTagLength: 16 });
    decipher.setAAD(aad(key.environmentId, key.keyVersion));
    decipher.setAuthTag(Buffer.from(match[3]!, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(match[2]!, "base64url")), decipher.final()]);
    let parsed: unknown;
    try { parsed = JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "k,n,s,x") return null;
    if (typeof record.s !== "string" || typeof record.n !== "string" || typeof record.k !== "string" || typeof record.x !== "string") {
      return null;
    }
    if (!PROOF_PATTERN.test(record.s) || !PROOF_PATTERN.test(record.n) || !PKCE_PATTERN.test(record.k)) {
      return null;
    }
    const expiresAt = new Date(record.x);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== record.x) return null;
    const remaining = expiresAt.getTime() - key.now.getTime();
    if (remaining <= 0 || remaining > MAX_COOKIE_TTL_MS) return null;
    return Object.freeze({
      state: record.s,
      nonce: record.n,
      pkceVerifier: record.k,
      expiresAt,
    });
  } catch {
    return null;
  }
}

type DirectPostIntent =
  | Readonly<{ kind: "DIRECT" }>
  | Readonly<{ kind: "ONBOARDING_CSRF"; csrfToken: string }>;

async function readDirectIntent(request: Request): Promise<DirectPostIntent | null> {
  if (request.method !== "POST") return null;
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (url.search !== "" || url.hash !== "" || request.headers.has("authorization")) return null;
  if (request.headers.get("content-type") !== FORM_CONTENT_TYPE) return null;
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_FORM_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks, total).toString("utf8");
  if (body === "intent=REGISTER_ORGANIZATION") {
    return { kind: "DIRECT" };
  }
  if (body.startsWith("csrf_token=")) {
    const token = body.slice("csrf_token=".length);
    if (isCanonicalProof(token)) {
      return { kind: "ONBOARDING_CSRF", csrfToken: token };
    }
  }
  return null;
}

function redirectToLogin(appOrigin: string | null, error: string, requestId: string): Response {
  const search = new URLSearchParams({ error, request_id: requestId });
  const location = appOrigin === null
    ? `/login?${search.toString()}`
    : new URL(`/login?${search.toString()}`, appOrigin).href;
  const headers = responseHeaders(requestId);
  headers.set("Location", location);
  headers.append("Set-Cookie", clearDirectCookie());
  return new Response(null, { status: 303, headers });
}

/**
 * Initiates a single-step Google Workspace Super Admin sign-up that requests
 * Directory consent immediately from `/login` without a prior OIDC hop.
 */
export async function handleDirectOrgSignupPost(request: Request): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);
  const intent = await readDirectIntent(request);
  if (intent === null) {
    return problemResponse("VALIDATION_FAILED", requestId);
  }

  let config;
  try {
    config = loadGoogleLoginRuntimeConfig();
  } catch {
    return problemResponse("PROVIDER_UNAVAILABLE", requestId);
  }

  let requestOrigin: string;
  try { requestOrigin = new URL(request.url).origin; } catch { return problemResponse("VALIDATION_FAILED", requestId); }
  if (
    requestOrigin !== config.appOrigin ||
    request.headers.get("origin") !== config.appOrigin ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    return problemResponse("FORBIDDEN", requestId);
  }

  try {
    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const authority = await inspectBrowserAuthority(request.headers, pool, {
      sessionPepper: config.sessionPepper,
    });
    if (authority.active && authority.activeKind === "WEB_SESSION") {
      const headers = responseHeaders(requestId);
      headers.set("Location", new URL("/admin/users", config.appOrigin).href);
      return new Response(null, { status: 303, headers });
    }
    if (intent.kind === "ONBOARDING_CSRF") {
      const onboardingCookies = cookieOccurrences(request.headers, ONBOARDING_COOKIE_NAME);
      const onboardingCredential = onboardingCookies !== null && onboardingCookies.length === 1
        ? onboardingCookies[0]!
        : null;
      if (
        !authority.active ||
        authority.activeKind !== "ONBOARDING" ||
        onboardingCredential === null ||
        !isCanonicalProof(onboardingCredential) ||
        !exactCsrfCredential(intent.csrfToken, onboardingCredential, config.sessionPepper)
      ) {
        return problemResponse("FORBIDDEN", requestId);
      }
    }

    const runtime = createConfiguredGoogleWorkspaceBootstrapRuntime();
    const networkHmac = clientNetworkHmac(trustedVercelClientIp(request.headers), config.rateHmacKey);
    const admission = await runtime.admitStart({ networkHmac, requestId });
    if (admission.outcome === "RATE_LIMITED") return problemResponse("RATE_LIMITED", requestId);
    if (admission.outcome !== "ADMITTED") return problemResponse("FORBIDDEN", requestId);

    const provider = createGoogleDirectoryConsentProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: new URL(GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH, config.appOrigin).href,
    });
    const authorization = await provider.createAuthorization();
    const authUrl = new URL(authorization.authorizationUrl);
    if (`${authUrl.origin}${authUrl.pathname}` !== GOOGLE_AUTHORIZATION_ORIGIN) {
      return problemResponse("PROVIDER_UNAVAILABLE", requestId);
    }

    const cookieValue = sealDirectCookie(
      {
        state: authorization.state,
        nonce: authorization.nonce,
        pkceVerifier: authorization.pkceVerifier,
        expiresAt: new Date(Date.now() + MAX_COOKIE_TTL_MS),
      },
      {
        environmentId: config.environmentId,
        keyVersion: config.pkceKeyVersion,
        key: config.pkceEncryptionKey,
      },
    );
    const headers = responseHeaders(requestId);
    headers.set("Location", authUrl.href);
    for (const stale of authority.staleCookieHeaders) {
      headers.append("Set-Cookie", stale);
    }
    if ((cookieOccurrences(request.headers, WEB_SESSION_COOKIE_NAME) ?? []).length > 0 && !authority.active) {
      headers.append("Set-Cookie", clearedWebSessionCookie());
    }
    if ((cookieOccurrences(request.headers, ONBOARDING_COOKIE_NAME) ?? []).length > 0) {
      headers.append("Set-Cookie", clearHostCookie(ONBOARDING_COOKIE_NAME));
    }
    if ((cookieOccurrences(request.headers, GOOGLE_WORKSPACE_SETUP_COOKIE_NAME) ?? []).length > 0) {
      headers.append("Set-Cookie", clearHostCookie(GOOGLE_WORKSPACE_SETUP_COOKIE_NAME));
    }
    headers.append("Set-Cookie", setDirectCookie(cookieValue));
    return new Response(null, { status: 303, headers });
  } catch {
    return problemResponse("PROVIDER_UNAVAILABLE", requestId);
  }
}

/**
 * Completes single-step organization sign-up: verifies Super Admin consent,
 * creates the workspace, runs initial Directory sync inline, issues a Web
 * session, and lands directly on `/admin/users`.
 */
export async function handleDirectOrgSignupCallbackGet(request: Request): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);
  let appOrigin: string | null = null;
  try {
    const config = loadGoogleLoginRuntimeConfig();
    appOrigin = config.appOrigin;

    const sessionCookies = cookieOccurrences(request.headers, WEB_SESSION_COOKIE_NAME);
    const directCookies = cookieOccurrences(request.headers, DIRECT_ORG_SIGNUP_COOKIE_NAME);
    if (
      request.headers.has("authorization") ||
      sessionCookies === null || sessionCookies.length > 0 ||
      directCookies === null || directCookies.length !== 1
    ) {
      return redirectToLogin(appOrigin, "ONBOARDING_EXPIRED", requestId);
    }

    const callbackUrl = new URL(request.url);
    if (callbackUrl.origin !== appOrigin) {
      return redirectToLogin(appOrigin, "CONSENT_ACCOUNT_MISMATCH", requestId);
    }
    if (callbackUrl.searchParams.get("error") === "access_denied") {
      return redirectToLogin(appOrigin, "GOOGLE_CONSENT_CANCELLED", requestId);
    }
    const callbackState = callbackUrl.searchParams.get("state");
    const callbackCode = callbackUrl.searchParams.get("code");
    if (
      !isCanonicalProof(callbackState) ||
      typeof callbackCode !== "string" ||
      callbackCode.length === 0 ||
      callbackCode.length > 4_096 ||
      callbackUrl.searchParams.has("error")
    ) {
      return redirectToLogin(appOrigin, "CONSENT_ACCOUNT_MISMATCH", requestId);
    }

    const transaction = openDirectCookie(directCookies[0], {
      environmentId: config.environmentId,
      keyVersion: config.pkceKeyVersion,
      key: config.pkceEncryptionKey,
      now: new Date(),
    });
    if (transaction === null || callbackState !== transaction.state) {
      return redirectToLogin(appOrigin, "CONSENT_ACCOUNT_MISMATCH", requestId);
    }

    const provider = createGoogleDirectoryConsentProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: new URL(GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH, appOrigin).href,
    });

    let evidence;
    try {
      evidence = await provider.exchangeAndProbe({
        callbackSearch: callbackUrl.search,
        state: transaction.state,
        nonce: transaction.nonce,
        pkceVerifier: transaction.pkceVerifier,
      });
    } catch {
      return redirectToLogin(appOrigin, "PROVIDER_UNAVAILABLE", requestId);
    }

    const secretAdapter = createConfiguredSecretAdapter();
    let createdReference: SecretReference | null = null;
    const candidateWorkspaceId = randomUUID();
    const secretMetadata = {
      workspaceId: candidateWorkspaceId,
      serviceIdentity: "GOOGLE_DIRECTORY_BOOTSTRAP_V1",
      purpose: "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN",
      requestId,
      bootstrapAttemptId: requestId,
    };

    try {
      if (evidence.isAdmin !== true) {
        return redirectToLogin(
          appOrigin,
          evidence.isDelegatedAdmin === true ? "DELEGATED_ADMIN_UNSUPPORTED" : "SUPER_ADMIN_REQUIRED",
          requestId,
        );
      }
      if (!hasExactGoogleDirectoryReadOnlyScopes(evidence.grantedScopes)) {
        return redirectToLogin(appOrigin, "DIRECTORY_SCOPE_REQUIRED", requestId);
      }
      if (
        !evidence.verifiedDomains.some((domain) =>
          domain.verified === true &&
          domain.normalizedDomain === evidence.hostedDomain &&
          (domain.kind === "PRIMARY" || domain.kind === "SECONDARY" || domain.kind === "ALIAS"),
        )
      ) {
        return redirectToLogin(appOrigin, "DOMAIN_NOT_VERIFIED", requestId);
      }

      createdReference = await secretAdapter.create(evidence.refreshToken, secretMetadata);
    } finally {
      evidence.refreshToken.fill(0);
    }

    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const verifiedDomains = evidence.verifiedDomains.map((domain) => ({
      normalizedDomain: domain.normalizedDomain,
      domainKind: domain.kind,
      providerParentDomain: domain.providerParentDomain,
    }));

    const signupRows = (await pool.query(COMPLETE_DIRECT_SIGNUP_SQL, [
      GOOGLE_ISSUER,
      evidence.providerSubject,
      evidence.normalizedEmail,
      evidence.hostedDomain,
      candidateWorkspaceId,
      evidence.customerId,
      evidence.primaryDomain,
      formatVerifiedDomainsCompositeArray(verifiedDomains),
      createdReference,
      [...evidence.grantedScopes],
      requestId,
    ])).rows as QueryResultRow[];

    const signupRow = signupRows[0];
    if (signupRows.length !== 1 || signupRow?.outcome !== "CREATED") {
      await secretAdapter.destroy(createdReference, secretMetadata).catch(() => {});
      const errorCode = signupRow?.outcome === "ALREADY_REGISTERED"
        ? "ORGANIZATION_ALREADY_REGISTERED"
        : "PROVIDER_UNAVAILABLE";
      return redirectToLogin(appOrigin, errorCode, requestId);
    }

    const bootstrapRuntime = createConfiguredGoogleWorkspaceBootstrapRuntime();
    try {
      await bootstrapRuntime.runDirectoryWorker();
    } catch {
      return redirectToLogin(appOrigin, "DIRECTORY_SYNC_PENDING", requestId);
    }

    const session = issueSessionCredential();
    const csrf = deriveCsrfCredential(session.raw_token, config.sessionPepper);
    const sessionRows = (await pool.query(ISSUE_DIRECT_SESSION_SQL, [
      signupRow.workspace_id,
      signupRow.user_id,
      signupRow.identity_id,
      signupRow.membership_id,
      Buffer.from(session.token_hash, "hex"),
      hashProof(csrf),
      requestId,
    ])).rows as QueryResultRow[];

    if (sessionRows.length !== 1 || sessionRows[0]?.outcome !== "SESSION_ISSUED") {
      return redirectToLogin(appOrigin, "DIRECTORY_SYNC_PENDING", requestId);
    }

    const headers = responseHeaders(requestId);
    headers.set("Location", new URL("/admin/users", appOrigin).href);
    headers.append("Set-Cookie", clearDirectCookie());
    headers.append("Set-Cookie", serializeWebSessionCookie(session.raw_token));
    return new Response(null, { status: 303, headers });
  } catch {
    return redirectToLogin(appOrigin, "PROVIDER_UNAVAILABLE", requestId);
  }
}
