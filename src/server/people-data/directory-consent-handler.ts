import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import type { DatabasePool } from "../db/core.ts";
import { createSafeProblem, problemResponse } from "../http/problem.ts";

export const DIRECTORY_CONSENT_COOKIE_NAME = "__Host-uptech_directory_tx";

interface DirectoryConsentHandlerRuntime {
  readonly config: {
    readonly appOrigin: string;
    readonly sessionPepper: Uint8Array;
  };
  readonly pool: Pick<DatabasePool, "query">;
  readonly service: {
    initiate(input: {
      readonly session: AuthenticatedWebSession;
      readonly requestId: string;
    }): Promise<{
      readonly authorizationUrl: URL;
      readonly cookie: string;
    }>;
    callback(input: {
      readonly session: AuthenticatedWebSession;
      readonly callbackSearch: string;
      readonly cookie: string;
      readonly requestId: string;
    }): Promise<{ readonly kind: "connected"; readonly connectorId: string }>;
  };
}

export interface DirectoryConsentHandlerDependencies {
  readonly loadRuntime: () => DirectoryConsentHandlerRuntime;
  readonly authenticate: (
    headers: Headers,
    sessionPepper: Uint8Array,
    pool: Pick<DatabasePool, "query">,
  ) => Promise<AuthenticatedWebSession>;
  readonly requireCsrf: (input: {
    readonly request: Request;
    readonly appOrigin: string;
    readonly session: AuthenticatedWebSession;
  }) => void;
  readonly requestId: (headers: Headers) => string;
  readonly log: (event: {
    readonly event: "UPTECH_DIRECTORY_CONSENT_V1";
    readonly request_id: string;
    readonly operation: "INITIATE" | "CALLBACK";
    readonly outcome: "REDIRECT" | "CONNECTED" | "DENIED" | "FAILED";
  }) => void;
}

function noStoreHeaders(requestId: string): Headers {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
}

function isApprovedGoogleAuthorizationUrl(value: URL): boolean {
  return value instanceof URL &&
    value.protocol === "https:" &&
    value.hostname === "accounts.google.com" &&
    value.port === "" &&
    value.username === "" &&
    value.password === "" &&
    value.pathname === "/o/oauth2/v2/auth" &&
    value.hash === "";
}

function safeCookieValue(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 4_500 &&
    /^[A-Za-z0-9._-]+$/u.test(value);
}

function readUniqueCookie(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null || cookieHeader.length > 16_384) return null;
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    values.push(part.slice(separator + 1).trim());
  }
  return values.length === 1 && safeCookieValue(values[0]) ? values[0] : null;
}

function consentCookie(value: string, maxAge: number): string {
  return `${DIRECTORY_CONSENT_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function callbackRedirect(
  appOrigin: string | null,
  outcome: "connected" | "failed",
  requestId: string,
): Response {
  const path = `/admin/connectors?directory=${outcome}`;
  const location = appOrigin === null ? path : new URL(path, appOrigin).href;
  const headers = noStoreHeaders(requestId);
  headers.set("Location", location);
  headers.set("Set-Cookie", consentCookie("", 0));
  return new Response(null, { status: 303, headers });
}

function safeLog(
  dependencies: DirectoryConsentHandlerDependencies,
  event: Parameters<DirectoryConsentHandlerDependencies["log"]>[0],
): void {
  try {
    dependencies.log(event);
  } catch {
    // Operational logging must never alter the authorization outcome.
  }
}

export function createDirectoryConsentPost(
  dependencies: DirectoryConsentHandlerDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    let runtime: DirectoryConsentHandlerRuntime;
    try {
      runtime = dependencies.loadRuntime();
    } catch {
      safeLog(dependencies, {
        event: "UPTECH_DIRECTORY_CONSENT_V1",
        request_id: requestId,
        operation: "INITIATE",
        outcome: "FAILED",
      });
      return problemResponse(createSafeProblem("PROVIDER_UNAVAILABLE", requestId));
    }

    let session: AuthenticatedWebSession;
    try {
      session = await dependencies.authenticate(
        request.headers,
        runtime.config.sessionPepper,
        runtime.pool,
      );
      dependencies.requireCsrf({
        request,
        appOrigin: runtime.config.appOrigin,
        session,
      });
    } catch {
      safeLog(dependencies, {
        event: "UPTECH_DIRECTORY_CONSENT_V1",
        request_id: requestId,
        operation: "INITIATE",
        outcome: "DENIED",
      });
      return problemResponse(createSafeProblem("UNAUTHENTICATED", requestId));
    }

    try {
      const result = await runtime.service.initiate({ session, requestId });
      if (
        !isApprovedGoogleAuthorizationUrl(result.authorizationUrl) ||
        !safeCookieValue(result.cookie)
      ) {
        throw new TypeError("Directory consent output is invalid");
      }
      const headers = noStoreHeaders(requestId);
      headers.set("Location", result.authorizationUrl.href);
      headers.set("Set-Cookie", consentCookie(result.cookie, 600));
      safeLog(dependencies, {
        event: "UPTECH_DIRECTORY_CONSENT_V1",
        request_id: requestId,
        operation: "INITIATE",
        outcome: "REDIRECT",
      });
      return new Response(null, { status: 303, headers });
    } catch {
      safeLog(dependencies, {
        event: "UPTECH_DIRECTORY_CONSENT_V1",
        request_id: requestId,
        operation: "INITIATE",
        outcome: "FAILED",
      });
      return problemResponse(createSafeProblem("PROVIDER_UNAVAILABLE", requestId));
    }
  };
}

export function createDirectoryConsentCallbackGet(
  dependencies: DirectoryConsentHandlerDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = dependencies.requestId(request.headers);
    let appOrigin: string | null = null;
    try {
      const runtime = dependencies.loadRuntime();
      appOrigin = runtime.config.appOrigin;
      const cookie = readUniqueCookie(
        request.headers,
        DIRECTORY_CONSENT_COOKIE_NAME,
      );
      if (cookie === null) throw new TypeError("Directory consent is invalid");
      const session = await dependencies.authenticate(
        request.headers,
        runtime.config.sessionPepper,
        runtime.pool,
      );
      const callbackUrl = new URL(request.url);
      await runtime.service.callback({
        session,
        callbackSearch: callbackUrl.search,
        cookie,
        requestId,
      });
      safeLog(dependencies, {
        event: "UPTECH_DIRECTORY_CONSENT_V1",
        request_id: requestId,
        operation: "CALLBACK",
        outcome: "CONNECTED",
      });
      return callbackRedirect(appOrigin, "connected", requestId);
    } catch {
      safeLog(dependencies, {
        event: "UPTECH_DIRECTORY_CONSENT_V1",
        request_id: requestId,
        operation: "CALLBACK",
        outcome: "DENIED",
      });
      return callbackRedirect(appOrigin, "failed", requestId);
    }
  };
}
