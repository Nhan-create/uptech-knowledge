import { timingSafeEqual } from "node:crypto";

import {
  deriveCsrfCredential,
  isCanonicalProof,
  ONBOARDING_COOKIE_NAME,
} from "../../auth/google/crypto.ts";
import { WEB_SESSION_COOKIE_NAME } from "../../sessions/session-security.ts";
import {
  createSafeProblem,
  type ProblemCode,
} from "../../http/problem.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "./crypto.ts";
import {
  BootstrapServiceError,
  type BootstrapServiceErrorCode,
  type GoogleWorkspaceBootstrapService,
} from "./service.ts";
import type { GoogleWorkspaceBootstrapStartAdmission } from "./repository.ts";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const MAX_COOKIE_VALUE_BYTES = 4_500;
const MAX_COOKIE_HEADER_BYTES = 16_384;
const MAX_CALLBACK_SEARCH_BYTES = 4_096;
const MAX_STATUS_AGE_SECONDS = 24 * 60 * 60;
const PUBLIC_ERROR_CODES = new Set<BootstrapServiceErrorCode>([
  "ONBOARDING_EXPIRED",
  "CONSENT_ACCOUNT_MISMATCH",
  "SUPER_ADMIN_REQUIRED",
  "DELEGATED_ADMIN_UNSUPPORTED",
  "GOOGLE_ORGANIZATION_MISMATCH",
  "DOMAIN_NOT_VERIFIED",
  "DIRECTORY_SCOPE_REQUIRED",
  "ORGANIZATION_ALREADY_REGISTERED",
  "PROVIDER_UNAVAILABLE",
]);
const CALLBACK_PARAMETER_LIMITS = new Map<string, number>([
  ["code", 4_096],
  ["state", 43],
  ["scope", 4_096],
  ["authuser", 32],
  ["prompt", 64],
  ["hd", 253],
  ["error", 128],
  ["error_description", 512],
  ["error_uri", 512],
]);

interface BootstrapHttpRuntime {
  readonly appOrigin: string;
  readonly sessionPepper: Uint8Array;
  readonly admitStart: GoogleWorkspaceBootstrapStartAdmission;
  readonly service: GoogleWorkspaceBootstrapService;
}

export interface BootstrapHttpDependencies {
  readonly loadRuntime: () => BootstrapHttpRuntime;
  readonly requestId: (headers: Headers) => string;
  readonly networkHmac: (headers: Headers) => Uint8Array;
  readonly now?: () => Date;
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

function problem(code: ProblemCode, requestId: string, clearSetup = false): Response {
  const document = createSafeProblem(code, requestId);
  const headers = responseHeaders(requestId);
  headers.set("Content-Type", "application/problem+json");
  if (clearSetup) headers.append("Set-Cookie", setupCookie("", 0));
  return new Response(JSON.stringify(document), { status: document.status, headers });
}

function cookieValues(headers: Headers, name: string): readonly string[] | null {
  const header = headers.get("cookie");
  if (header === null) return [];
  if (Buffer.byteLength(header, "utf8") > MAX_COOKIE_HEADER_BYTES) return null;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_COOKIE_VALUE_BYTES) return null;
    values.push(value);
  }
  return values;
}

function exactlyOneCookie(headers: Headers, name: string): string | null {
  const values = cookieValues(headers, name);
  return values !== null && values.length === 1 ? values[0]! : null;
}

function absentCookie(headers: Headers, name: string): boolean {
  const values = cookieValues(headers, name);
  return values !== null && values.length === 0;
}

function safeCookieValue(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    Buffer.byteLength(value, "utf8") <= MAX_COOKIE_VALUE_BYTES &&
    /^[A-Za-z0-9._-]+$/u.test(value);
}

function setupCookie(value: string, maxAge: number): string {
  return `${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function onboardingCookie(value: string, maxAge: number): string {
  return `${ONBOARDING_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function approvedAuthorizationUrl(value: URL): boolean {
  return value instanceof URL &&
    `${value.origin}${value.pathname}` === GOOGLE_AUTHORIZATION_URL &&
    value.username === "" && value.password === "" && value.port === "" &&
    value.hash === "";
}

function exactCsrf(headers: Headers, onboardingCredential: string, pepper: Uint8Array): boolean {
  if (headers.get("sec-fetch-site") !== "same-origin") return false;
  const supplied = headers.get("x-csrf-token");
  if (supplied === null || !isCanonicalProof(supplied)) return false;
  try {
    const expected = deriveCsrfCredential(onboardingCredential, pepper);
    return timingSafeEqual(Buffer.from(supplied, "ascii"), Buffer.from(expected, "ascii"));
  } catch {
    return false;
  }
}

function validCallbackSearch(search: string): boolean {
  if (search.length < 1 || Buffer.byteLength(search, "utf8") > MAX_CALLBACK_SEARCH_BYTES || !search.startsWith("?")) return false;
  const parameters = new URLSearchParams(search.slice(1));
  for (const key of parameters.keys()) {
    const limit = CALLBACK_PARAMETER_LIMITS.get(key);
    const values = parameters.getAll(key);
    if (limit === undefined || values.length !== 1 || values[0]!.length < 1 || Buffer.byteLength(values[0]!, "utf8") > limit || values[0]!.includes("\0")) return false;
  }
  const states = parameters.getAll("state");
  const codes = parameters.getAll("code");
  const errors = parameters.getAll("error");
  if (states.length !== 1 || !isCanonicalProof(states[0])) return false;
  return (codes.length === 1 && errors.length === 0) ||
    (codes.length === 0 && errors.length === 1);
}

function publicError(error: unknown): BootstrapServiceErrorCode {
  const code = error instanceof BootstrapServiceError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
  return typeof code === "string" && PUBLIC_ERROR_CODES.has(code as BootstrapServiceErrorCode)
    ? code as BootstrapServiceErrorCode
    : "PROVIDER_UNAVAILABLE";
}

function callbackRedirect(appOrigin: string | null, path: string, requestId: string): Response {
  const location = appOrigin === null ? path : new URL(path, appOrigin).href;
  const headers = responseHeaders(requestId);
  headers.set("Location", location);
  headers.append("Set-Cookie", setupCookie("", 0));
  return new Response(null, { status: 303, headers });
}

function callbackFailure(appOrigin: string | null, code: BootstrapServiceErrorCode, requestId: string): Response {
  const query = new URLSearchParams({ error: code, request_id: requestId });
  return callbackRedirect(appOrigin, `/login?${query.toString()}`, requestId);
}

export function createGoogleWorkspaceBootstrapPost(dependencies: BootstrapHttpDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    let runtime: BootstrapHttpRuntime;
    try {
      runtime = dependencies.loadRuntime();
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
    if (request.body !== null) return problem("VALIDATION_FAILED", requestId);
    const onboardingCredential = exactlyOneCookie(request.headers, ONBOARDING_COOKIE_NAME);
    if (onboardingCredential === null || !isCanonicalProof(onboardingCredential)) return problem("UNAUTHENTICATED", requestId);
    if (!absentCookie(request.headers, GOOGLE_WORKSPACE_SETUP_COOKIE_NAME) ||
        !absentCookie(request.headers, WEB_SESSION_COOKIE_NAME) ||
        request.headers.has("authorization")) {
      return problem("FORBIDDEN", requestId);
    }
    let requestOrigin: string;
    try { requestOrigin = new URL(request.url).origin; } catch { return problem("VALIDATION_FAILED", requestId); }
    if (requestOrigin !== runtime.appOrigin || request.headers.get("origin") !== runtime.appOrigin ||
        !exactCsrf(request.headers, onboardingCredential, runtime.sessionPepper)) {
      return problem("FORBIDDEN", requestId);
    }
    try {
      const networkHmac = dependencies.networkHmac(request.headers);
      const admission = await runtime.admitStart({ networkHmac, requestId });
      if (admission.outcome === "RATE_LIMITED") return problem("RATE_LIMITED", requestId);
      if (admission.outcome === "DENIED") return problem("FORBIDDEN", requestId);
      if (admission.outcome !== "ADMITTED") return problem("PROVIDER_UNAVAILABLE", requestId);
      const result = await runtime.service.initiate({ onboardingCredential, requestId });
      if (!approvedAuthorizationUrl(result.authorizationUrl) || !safeCookieValue(result.transactionCookie)) {
        return problem("PROVIDER_UNAVAILABLE", requestId);
      }
      const headers = responseHeaders(requestId);
      headers.set("Location", result.authorizationUrl.href);
      headers.set("Set-Cookie", setupCookie(result.transactionCookie, 600));
      return new Response(null, { status: 303, headers });
    } catch (error) {
      const code = publicError(error);
      return problem(code === "ONBOARDING_EXPIRED" ? "UNAUTHENTICATED" : code === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "FORBIDDEN", requestId);
    }
  };
}

export function createGoogleWorkspaceBootstrapCallbackGet(dependencies: BootstrapHttpDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    let appOrigin: string | null = null;
    try {
      const runtime = dependencies.loadRuntime();
      appOrigin = runtime.appOrigin;
      const onboardingCredential = exactlyOneCookie(request.headers, ONBOARDING_COOKIE_NAME);
      const transactionCookie = exactlyOneCookie(request.headers, GOOGLE_WORKSPACE_SETUP_COOKIE_NAME);
      if (onboardingCredential === null || !isCanonicalProof(onboardingCredential) ||
          transactionCookie === null || !safeCookieValue(transactionCookie) ||
          !absentCookie(request.headers, WEB_SESSION_COOKIE_NAME) || request.headers.has("authorization")) {
        return callbackFailure(appOrigin, "ONBOARDING_EXPIRED", requestId);
      }
      const callbackUrl = new URL(request.url);
      if (callbackUrl.origin !== appOrigin || !validCallbackSearch(callbackUrl.search)) {
        return callbackFailure(appOrigin, "CONSENT_ACCOUNT_MISMATCH", requestId);
      }
      const result = await runtime.service.callback({
        onboardingCredential,
        callbackSearch: callbackUrl.search,
        transactionCookie,
        requestId,
      });
      const now = dependencies.now?.() ?? new Date();
      const maxAge = Math.floor((result.statusExpiresAt.getTime() - now.getTime()) / 1_000);
      if (result.outcome !== "PROVISIONING" || !isCanonicalProof(result.statusCredential) ||
          !Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > MAX_STATUS_AGE_SECONDS) {
        return callbackFailure(appOrigin, "PROVIDER_UNAVAILABLE", requestId);
      }
      const response = callbackRedirect(appOrigin, "/setup/provisioning", requestId);
      response.headers.append("Set-Cookie", onboardingCookie(result.statusCredential, maxAge));
      return response;
    } catch (error) {
      if (appOrigin === null) return problem("PROVIDER_UNAVAILABLE", requestId, true);
      return callbackFailure(appOrigin, publicError(error), requestId);
    }
  };
}
