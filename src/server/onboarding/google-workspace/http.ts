import { timingSafeEqual } from "node:crypto";

import {
  deriveCsrfCredential,
  hashProof,
  isCanonicalProof,
  LOGIN_TRANSACTION_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
} from "../../auth/google/crypto.ts";
import type {
  GoogleLoginInitiationResult,
  GoogleLoginService,
} from "../../auth/google/service.ts";
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
import type {
  BootstrapStatusOutcome,
  GoogleWorkspaceBootstrapRepository,
  GoogleWorkspaceBootstrapStartAdmission,
} from "./repository.ts";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const MAX_COOKIE_VALUE_BYTES = 4_500;
const MAX_COOKIE_HEADER_BYTES = 16_384;
const MAX_CALLBACK_SEARCH_BYTES = 4_096;
const MAX_MUTATING_FORM_BYTES = 96;
const MAX_STATUS_AGE_SECONDS = 24 * 60 * 60;
const EMPTY_BODY_BYTES = "0";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const FORM_FORBIDDEN_BODY_HEADERS = Object.freeze([
  "content-encoding",
  "content-range",
  "expect",
  "trailer",
]);
const BODY_METADATA_HEADERS = Object.freeze([
  "content-encoding",
  "content-range",
  "content-type",
  "expect",
  "trailer",
]);
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

interface BootstrapStatusRuntime {
  readonly appOrigin: string;
  readonly sessionPepper: Uint8Array;
  readonly repository: Pick<
    GoogleWorkspaceBootstrapRepository,
    "readStatus" | "retrySync" | "finish" | "revokeCapability"
  >;
  readonly normalLoginService?: Pick<GoogleLoginService, "initiate">;
}

interface AccessRequestRuntime {
  readonly appOrigin: string;
  readonly sessionPepper: Uint8Array;
  readonly repository: Pick<
    GoogleWorkspaceBootstrapRepository,
    "submitAccessRequest" | "readAccessRequest"
  >;
}

export interface BootstrapHttpDependencies {
  readonly loadRuntime: () => BootstrapHttpRuntime;
  readonly requestId: (headers: Headers) => string;
  readonly networkHmac: (headers: Headers) => Uint8Array;
  readonly now?: () => Date;
}

export interface BootstrapStatusDependencies {
  readonly loadRuntime: () => BootstrapStatusRuntime;
  readonly requestId: (headers: Headers) => string;
  readonly canonicalClientIp?: (headers: Headers) => string;
}

export interface AccessRequestDependencies {
  readonly loadRuntime: () => AccessRequestRuntime;
  readonly requestId: (headers: Headers) => string;
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

export function serializeOnboardingCookie(value: string, maxAge: number): string {
  return `${ONBOARDING_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function loginTransactionCookie(value: string): string {
  return `${LOGIN_TRANSACTION_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

function approvedAuthorizationUrl(value: URL): boolean {
  return value instanceof URL &&
    `${value.origin}${value.pathname}` === GOOGLE_AUTHORIZATION_URL &&
    value.username === "" && value.password === "" && value.port === "" &&
    value.hash === "";
}

export function exactCsrfCredential(
  supplied: string | null,
  onboardingCredential: string,
  pepper: Uint8Array,
): boolean {
  if (supplied === null || !isCanonicalProof(supplied)) return false;
  try {
    const expected = deriveCsrfCredential(onboardingCredential, pepper);
    return timingSafeEqual(Buffer.from(supplied, "ascii"), Buffer.from(expected, "ascii"));
  } catch {
    return false;
  }
}

function exactCsrf(headers: Headers, onboardingCredential: string, pepper: Uint8Array): boolean {
  return headers.get("sec-fetch-site") === "same-origin" &&
    exactCsrfCredential(headers.get("x-csrf-token"), onboardingCredential, pepper);
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

const STATUS_PUBLIC_STATES = new Set<BootstrapStatusOutcome>([
  "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  "READY",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
  "ONBOARDING_EXPIRED",
]);

type StatusPublicState = Exclude<BootstrapStatusOutcome, "DENIED">;

function stateResponse(state: StatusPublicState, requestId: string): Response {
  const headers = responseHeaders(requestId);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ state }), { status: 200, headers });
}

function bodylessEnvelope(
  request: Request,
  expectedMethod: "GET" | "POST",
  requestId: string,
): Response | null {
  if (request.method !== expectedMethod) return problem("VALIDATION_FAILED", requestId);
  let url: URL;
  try { url = new URL(request.url); } catch { return problem("VALIDATION_FAILED", requestId); }
  if (url.search !== "" || url.hash !== "") return problem("VALIDATION_FAILED", requestId);

  const contentLength = request.headers.get("content-length");
  if (request.headers.has("transfer-encoding") ||
      BODY_METADATA_HEADERS.some((name) => request.headers.has(name)) ||
      (expectedMethod === "POST"
        ? contentLength !== EMPTY_BODY_BYTES
        : contentLength !== null && contentLength !== EMPTY_BODY_BYTES)) {
    return problem("VALIDATION_FAILED", requestId);
  }
  return null;
}

type MutatingPostEnvelope =
  | { readonly csrfToken: string }
  | { readonly response: Response };

async function readBoundedFormBody(request: Request, declaredLength: number | null): Promise<string | null> {
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (total + item.value.byteLength > MAX_MUTATING_FORM_BYTES) {
        try { await reader.cancel(); } catch { /* rejection remains fail-closed */ }
        return null;
      }
      chunks.push(item.value);
      total += item.value.byteLength;
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  if (declaredLength !== null && declaredLength !== total) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function mutatingPostEnvelope(request: Request, requestId: string): Promise<MutatingPostEnvelope> {
  if (request.method !== "POST") return { response: problem("VALIDATION_FAILED", requestId) };
  let url: URL;
  try { url = new URL(request.url); } catch { return { response: problem("VALIDATION_FAILED", requestId) }; }
  if (url.search !== "" || url.hash !== "" || request.headers.has("authorization") ||
      request.headers.has("transfer-encoding") ||
      FORM_FORBIDDEN_BODY_HEADERS.some((name) => request.headers.has(name))) {
    return { response: problem("VALIDATION_FAILED", requestId) };
  }

  const contentType = request.headers.get("content-type");
  const headerToken = request.headers.get("x-csrf-token");
  const contentLength = request.headers.get("content-length");
  if (contentType === null) {
    if (request.body !== null || contentLength !== EMPTY_BODY_BYTES ||
        headerToken === null || !isCanonicalProof(headerToken)) {
      return { response: problem("VALIDATION_FAILED", requestId) };
    }
    return { csrfToken: headerToken };
  }

  if (contentType !== FORM_CONTENT_TYPE || request.headers.has("x-csrf-token")) {
    return { response: problem("VALIDATION_FAILED", requestId) };
  }
  let declaredLength: number | null = null;
  if (contentLength !== null) {
    if (!/^[1-9][0-9]*$/u.test(contentLength)) {
      return { response: problem("VALIDATION_FAILED", requestId) };
    }
    declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_MUTATING_FORM_BYTES) {
      if (request.body !== null) {
        try { await request.body.cancel(); } catch { /* rejection remains fail-closed */ }
      }
      return { response: problem("VALIDATION_FAILED", requestId) };
    }
  }
  const body = await readBoundedFormBody(request, declaredLength);
  const match = body === null ? null : /^csrf_token=([A-Za-z0-9_-]{43})$/u.exec(body);
  if (match === null || !isCanonicalProof(match[1])) {
    return { response: problem("VALIDATION_FAILED", requestId) };
  }
  return { csrfToken: match[1]! };
}

function recoveryCredential(
  request: Request,
  runtime: Pick<BootstrapStatusRuntime, "appOrigin" | "sessionPepper">,
  requestId: string,
  mutating: boolean,
  allowSetupCookie = false,
  selectedCsrfToken?: string,
): { readonly credential: string } | { readonly response: Response } {
  let url: URL;
  try { url = new URL(request.url); } catch { return { response: problem("VALIDATION_FAILED", requestId) }; }
  if (url.origin !== runtime.appOrigin) return { response: problem("FORBIDDEN", requestId) };

  const credential = exactlyOneCookie(request.headers, ONBOARDING_COOKIE_NAME);
  if (credential === null || !isCanonicalProof(credential)) {
    return { response: problem("UNAUTHENTICATED", requestId) };
  }
  if ((!allowSetupCookie && !absentCookie(request.headers, GOOGLE_WORKSPACE_SETUP_COOKIE_NAME)) ||
      !absentCookie(request.headers, WEB_SESSION_COOKIE_NAME) ||
      request.headers.has("authorization")) {
    return { response: problem("FORBIDDEN", requestId) };
  }
  const csrfToken = selectedCsrfToken ?? request.headers.get("x-csrf-token");
  if (mutating && (request.headers.get("origin") !== runtime.appOrigin ||
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      !exactCsrfCredential(csrfToken, credential, runtime.sessionPepper))) {
    return { response: problem("FORBIDDEN", requestId) };
  }
  return { credential };
}

function clearSetupCookie(response: Response): Response {
  response.headers.append("Set-Cookie", setupCookie("", 0));
  return response;
}

function clearOnboardingCookies(response: Response): Response {
  response.headers.append("Set-Cookie", serializeOnboardingCookie("", 0));
  return clearSetupCookie(response);
}

function accessRequestResponse(requestIdValue: string, status: string, requestId: string): Response {
  const headers = responseHeaders(requestId);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ request_id: requestIdValue, status }), { status: 200, headers });
}

function recoveryFailureRedirect(appOrigin: string, error: string, requestId: string): Response {
  const location = new URL("/login", appOrigin);
  location.search = new URLSearchParams({ error, request_id: requestId }).toString();
  const headers = responseHeaders(requestId);
  headers.set("Location", location.href);
  headers.append("Set-Cookie", serializeOnboardingCookie("", 0));
  headers.append("Set-Cookie", setupCookie("", 0));
  return new Response(null, { status: 303, headers });
}

export function createBootstrapStatusGet(dependencies: BootstrapStatusDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const invalidEnvelope = bodylessEnvelope(request, "GET", requestId);
    if (invalidEnvelope !== null) return invalidEnvelope;
    let runtime: BootstrapStatusRuntime;
    try { runtime = dependencies.loadRuntime(); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    const authority = recoveryCredential(request, runtime, requestId, false);
    if ("response" in authority) return authority.response;
    try {
      const result = await runtime.repository.readStatus({
        statusTokenHash: hashProof(authority.credential),
        requestId,
      });
      if (result.outcome === "DENIED") return problem("UNAUTHENTICATED", requestId);
      if (!STATUS_PUBLIC_STATES.has(result.outcome)) return problem("PROVIDER_UNAVAILABLE", requestId);
      return stateResponse(result.outcome, requestId);
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createBootstrapSyncRetryPost(dependencies: BootstrapStatusDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const invalidEnvelope = bodylessEnvelope(request, "POST", requestId);
    if (invalidEnvelope !== null) return invalidEnvelope;
    let runtime: BootstrapStatusRuntime;
    try { runtime = dependencies.loadRuntime(); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    const authority = recoveryCredential(request, runtime, requestId, true);
    if ("response" in authority) return authority.response;
    try {
      const result = await runtime.repository.retrySync({
        statusTokenHash: hashProof(authority.credential),
        requestId,
      });
      if (result.outcome === "DENIED") return problem("UNAUTHENTICATED", requestId);
      const state: BootstrapStatusOutcome = result.outcome === "REQUEUED"
        ? "DIRECTORY_BOOTSTRAP_SYNC_PENDING"
        : result.outcome;
      if (!STATUS_PUBLIC_STATES.has(state)) return problem("PROVIDER_UNAVAILABLE", requestId);
      return stateResponse(state as StatusPublicState, requestId);
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createBootstrapFinishPost(dependencies: BootstrapStatusDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const envelope = await mutatingPostEnvelope(request, requestId);
    if ("response" in envelope) return envelope.response;
    let runtime: BootstrapStatusRuntime;
    try { runtime = dependencies.loadRuntime(); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    const authority = recoveryCredential(request, runtime, requestId, true, false, envelope.csrfToken);
    if ("response" in authority) return authority.response;
    if (runtime.normalLoginService === undefined || dependencies.canonicalClientIp === undefined) {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
    let canonicalClientIp: string;
    try { canonicalClientIp = dependencies.canonicalClientIp(request.headers); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    try {
      const finished = await runtime.repository.finish({
        statusTokenHash: hashProof(authority.credential),
        requestId,
      });
      if (finished.outcome !== "FINISHED") return problem("UNAUTHENTICATED", requestId);

      let login: GoogleLoginInitiationResult;
      try {
        login = await runtime.normalLoginService.initiate({ canonicalClientIp, requestId });
      } catch {
        return recoveryFailureRedirect(runtime.appOrigin, "temporarily_unavailable", requestId);
      }
      if (login.outcome !== "REDIRECT") {
        return recoveryFailureRedirect(
          runtime.appOrigin,
          login.outcome === "RATE_LIMITED" ? "rate_limited" : "login_failed",
          requestId,
        );
      }
      if (!approvedAuthorizationUrl(login.authorizationUrl) || !safeCookieValue(login.loginCookie)) {
        return recoveryFailureRedirect(runtime.appOrigin, "temporarily_unavailable", requestId);
      }
      const headers = responseHeaders(requestId);
      headers.set("Location", login.authorizationUrl.href);
      headers.append("Set-Cookie", loginTransactionCookie(login.loginCookie));
      headers.append("Set-Cookie", serializeOnboardingCookie("", 0));
      headers.append("Set-Cookie", setupCookie("", 0));
      return new Response(null, { status: 303, headers });
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createOnboardingLogoutPost(dependencies: BootstrapStatusDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const envelope = await mutatingPostEnvelope(request, requestId);
    if ("response" in envelope) return envelope.response;
    let runtime: BootstrapStatusRuntime;
    try { runtime = dependencies.loadRuntime(); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    const authority = recoveryCredential(request, runtime, requestId, true, true, envelope.csrfToken);
    if ("response" in authority) return authority.response;
    try {
      const result = await runtime.repository.revokeCapability({
        statusTokenHash: hashProof(authority.credential),
        requestId,
      });
      if (result.outcome === "DENIED") {
        return clearSetupCookie(problem("UNAUTHENTICATED", requestId));
      }
      if (result.outcome !== "REVOKED") {
        return clearSetupCookie(problem("PROVIDER_UNAVAILABLE", requestId));
      }
      const headers = responseHeaders(requestId);
      headers.set("Location", new URL("/login", runtime.appOrigin).href);
      return clearOnboardingCookies(new Response(null, { status: 303, headers }));
    } catch {
      return clearSetupCookie(problem("PROVIDER_UNAVAILABLE", requestId));
    }
  };
}

export function createAccessRequestPost(dependencies: AccessRequestDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const invalidEnvelope = bodylessEnvelope(request, "POST", requestId);
    if (invalidEnvelope !== null) return invalidEnvelope;
    let runtime: AccessRequestRuntime;
    try { runtime = dependencies.loadRuntime(); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    const authority = recoveryCredential(request, runtime, requestId, true);
    if ("response" in authority) return authority.response;
    try {
      const result = await runtime.repository.submitAccessRequest({
        statusTokenHash: hashProof(authority.credential),
        requestId,
      });
      if (result.outcome === "DENIED") return problem("UNAUTHENTICATED", requestId);
      if (result.outcome !== "PENDING") return problem("PROVIDER_UNAVAILABLE", requestId);
      return accessRequestResponse(result.requestId, result.status, requestId);
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createCurrentAccessRequestGet(dependencies: AccessRequestDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const invalidEnvelope = bodylessEnvelope(request, "GET", requestId);
    if (invalidEnvelope !== null) return invalidEnvelope;
    let runtime: AccessRequestRuntime;
    try { runtime = dependencies.loadRuntime(); }
    catch { return problem("PROVIDER_UNAVAILABLE", requestId); }
    const authority = recoveryCredential(request, runtime, requestId, false);
    if ("response" in authority) return authority.response;
    try {
      const result = await runtime.repository.readAccessRequest({
        statusTokenHash: hashProof(authority.credential),
        requestId,
      });
      if (result.outcome === "DENIED") return problem("UNAUTHENTICATED", requestId);
      if (result.outcome !== "FOUND") return problem("PROVIDER_UNAVAILABLE", requestId);
      return accessRequestResponse(result.requestId, result.status, requestId);
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createGoogleWorkspaceBootstrapPost(dependencies: BootstrapHttpDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    const envelope = await mutatingPostEnvelope(request, requestId);
    if ("response" in envelope) return envelope.response;
    let runtime: BootstrapHttpRuntime;
    try {
      runtime = dependencies.loadRuntime();
    } catch {
      return problem("PROVIDER_UNAVAILABLE", requestId);
    }
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
        request.headers.get("sec-fetch-site") !== "same-origin" ||
        !exactCsrfCredential(envelope.csrfToken, onboardingCredential, runtime.sessionPepper)) {
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
      response.headers.append("Set-Cookie", serializeOnboardingCookie(result.statusCredential, maxAge));
      return response;
    } catch (error) {
      if (appOrigin === null) return problem("PROVIDER_UNAVAILABLE", requestId, true);
      return callbackFailure(appOrigin, publicError(error), requestId);
    }
  };
}
