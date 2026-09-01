import { requestIdFromHeaders } from "../../http/problem.ts";
import { boundedJson, mobileAuthenticatedDenialProblem, mobileCallbackRedirect, mobileJson, mobileProblem, mobileSessionProblem } from "./http.ts";
import { parseHandoffExchangeBody, parseMobileTransactionBody, parseWorkspaceSwitchBody, type MobilePlatform } from "./protocol.ts";
import type { MobileMembershipSummary } from "./session-service.ts";
import type { MobileAuthUiCategory } from "./google-service.ts";

interface MobileGoogleRouteService {
  rejectMalformedIngress(input: { readonly canonicalClientIp: string; readonly requestId: string }): Promise<"RECORDED" | "RATE_LIMITED">;
  initiate(input: { readonly platform: MobilePlatform; readonly appExchangeChallenge: Uint8Array;
    readonly installationBinding: Uint8Array; readonly canonicalClientIp: string; readonly requestId: string }): Promise<
      | { readonly outcome: "REDIRECT"; readonly authorizationUrl: URL }
      | { readonly outcome: "RATE_LIMITED" | "DENIED" | "CREATED" }>;
  callback(input: { readonly callbackSearch: string; readonly canonicalClientIp: string; readonly requestId: string }): Promise<
    | { readonly outcome: "HANDOFF"; readonly handoffCode: string }
    | { readonly outcome: "DENIED" | "RATE_LIMITED"; readonly category?: MobileAuthUiCategory }>;
}

interface MobileSessionRouteService {
  exchangeHandoff(input: { readonly handoffCode: string; readonly appExchangeVerifier: string;
    readonly installationSecret: string; readonly canonicalClientIp: string; readonly requestId: string }): Promise<
      | { readonly outcome: "ISSUED"; readonly accessToken: string; readonly refreshToken: string;
          readonly accessExpiresAt: Date; readonly refreshExpiresAt: Date; readonly activeWorkspaceId: string;
          readonly memberships: readonly MobileMembershipSummary[] }
      | { readonly outcome: "ACCESS_DENIED"; readonly category: MobileAuthUiCategory }
      | { readonly outcome: "RATE_LIMITED" | "DENIED" }>;
  listWorkspaces(authorization: string | null): Promise<readonly MobileMembershipSummary[]>;
  authenticateBearer(authorization: string | null): Promise<unknown>;
  refresh(input: { readonly refreshToken: string; readonly installationSecret: string;
    readonly idempotencyKey: string; readonly requestId: string }): Promise<unknown>;
  switchWorkspace(input: { readonly authorization: string | null; readonly targetWorkspaceId: string;
    readonly installationSecret: string; readonly idempotencyKey: string; readonly requestId: string }): Promise<
      | { readonly outcome: "ROTATED" | "REPLAY"; readonly accessToken: string; readonly refreshToken: string;
          readonly accessExpiresAt: Date; readonly refreshExpiresAt: Date }
      | { readonly outcome: "DENIED" }>;
}

interface MobileGoogleTransactionRuntime {
  readonly config: { readonly appReturnUri: string };
  readonly googleService: MobileGoogleRouteService;
  readonly sessionService: MobileSessionRouteService;
}

function isValidationError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof TypeError ||
    (error instanceof Error && error.name === "MobileProtocolError");
}

export function createMobileRouteHandlers(dependencies: {
  readonly appReturnUri: string;
  readonly clientIp: (headers: Headers) => string;
  readonly googleService: MobileGoogleRouteService;
  readonly sessionService: MobileSessionRouteService;
}) {
  const malformed = async (canonicalClientIp: string, requestId: string) => {
    try {
      const result = await dependencies.googleService.rejectMalformedIngress({ canonicalClientIp, requestId });
      return result === "RATE_LIMITED"
        ? mobileProblem("RATE_LIMITED", requestId)
        : mobileProblem("VALIDATION_FAILED", requestId);
    } catch {
      return mobileProblem("PROVIDER_UNAVAILABLE", requestId);
    }
  };

  return Object.freeze({
    async googleTransaction(request: Request) {
      const requestId = requestIdFromHeaders(request.headers);
      let canonicalClientIp: string;
      try { canonicalClientIp = dependencies.clientIp(request.headers); }
      catch { return mobileProblem("PROVIDER_UNAVAILABLE", requestId); }
      let body: ReturnType<typeof parseMobileTransactionBody>;
      try { body = parseMobileTransactionBody(await boundedJson(request)); }
      catch (error) {
        return isValidationError(error)
          ? malformed(canonicalClientIp, requestId)
          : mobileProblem("PROVIDER_UNAVAILABLE", requestId);
      }
      try {
        const result = await dependencies.googleService.initiate({ ...body, canonicalClientIp, requestId });
        if (result.outcome === "RATE_LIMITED") return mobileProblem("RATE_LIMITED", requestId);
        if (result.outcome !== "REDIRECT") return mobileProblem("FORBIDDEN", requestId);
        return mobileJson({ authorization_url: result.authorizationUrl.href, expires_in: 300 }, requestId, 201);
      } catch { return mobileProblem("PROVIDER_UNAVAILABLE", requestId); }
    },

    async handoffExchange(request: Request) {
      const requestId = requestIdFromHeaders(request.headers);
      let canonicalClientIp: string;
      try { canonicalClientIp = dependencies.clientIp(request.headers); }
      catch { return mobileProblem("PROVIDER_UNAVAILABLE", requestId); }
      let body: ReturnType<typeof parseHandoffExchangeBody>;
      try { body = parseHandoffExchangeBody(await boundedJson(request)); }
      catch (error) {
        return isValidationError(error)
          ? malformed(canonicalClientIp, requestId)
          : mobileProblem("PROVIDER_UNAVAILABLE", requestId);
      }
      try {
        const result = await dependencies.sessionService.exchangeHandoff({ ...body, canonicalClientIp, requestId });
        if (result.outcome === "RATE_LIMITED") return mobileProblem("RATE_LIMITED", requestId);
        if (result.outcome === "ACCESS_DENIED") {
          return mobileAuthenticatedDenialProblem(result.category, requestId);
        }
        if (result.outcome !== "ISSUED") return mobileProblem("UNAUTHENTICATED", requestId);
        return mobileJson({ access_token: result.accessToken, refresh_token: result.refreshToken,
          access_expires_at: result.accessExpiresAt.toISOString(), refresh_expires_at: result.refreshExpiresAt.toISOString(),
          active_workspace_id: result.activeWorkspaceId, memberships: result.memberships }, requestId);
      } catch { return mobileProblem("PROVIDER_UNAVAILABLE", requestId); }
    },

    async googleCallback(request: Request) {
      const requestId = requestIdFromHeaders(request.headers);
      let canonicalClientIp: string;
      try { canonicalClientIp = dependencies.clientIp(request.headers); }
      catch { return mobileCallbackRedirect(dependencies.appReturnUri, requestId,
        { outcome: "DENIED" }); }
      try {
        const result = await dependencies.googleService.callback({ callbackSearch: new URL(request.url).search,
          canonicalClientIp, requestId });
        return result.outcome === "HANDOFF"
          ? mobileCallbackRedirect(dependencies.appReturnUri, requestId,
            { outcome: "HANDOFF", handoffCode: result.handoffCode })
          : mobileCallbackRedirect(dependencies.appReturnUri, requestId,
            { outcome: "DENIED" });
      } catch {
        return mobileCallbackRedirect(dependencies.appReturnUri, requestId,
          { outcome: "DENIED" });
      }
    },

    async workspaces(request: Request) {
      const requestId = requestIdFromHeaders(request.headers);
      try {
        const memberships = await dependencies.sessionService.listWorkspaces(request.headers.get("authorization"));
        return mobileJson({ memberships }, requestId);
      } catch (error) {
        return mobileSessionProblem(error, requestId);
      }
    },

    async switchWorkspace(request: Request) {
      const requestId = requestIdFromHeaders(request.headers);
      try {
        const body = parseWorkspaceSwitchBody(await boundedJson(request));
        const idempotencyKey = request.headers.get("idempotency-key") ?? "";
        if (!/^[A-Za-z0-9._~-]{1,128}$/u.test(idempotencyKey)) {
          throw new TypeError("Invalid idempotency key");
        }
        const result = await dependencies.sessionService.switchWorkspace({
          authorization: request.headers.get("authorization"), ...body, idempotencyKey, requestId,
        });
        if (result.outcome === "DENIED") return mobileProblem("FORBIDDEN", requestId);
        return mobileJson({ access_token: result.accessToken, refresh_token: result.refreshToken,
          access_expires_at: result.accessExpiresAt.toISOString(),
          refresh_expires_at: result.refreshExpiresAt.toISOString() }, requestId);
      } catch (error) {
        return isValidationError(error)
          ? mobileProblem("VALIDATION_FAILED", requestId)
          : mobileSessionProblem(error, requestId);
      }
    },
  });
}

export function createMobileGoogleTransactionPost(dependencies: {
  readonly createRuntime: () => MobileGoogleTransactionRuntime;
  readonly clientIp: (headers: Headers) => string;
}) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFromHeaders(request.headers);
    try {
      const runtime = dependencies.createRuntime();
      const response = await createMobileRouteHandlers({
        appReturnUri: runtime.config.appReturnUri,
        clientIp: dependencies.clientIp,
        googleService: runtime.googleService,
        sessionService: runtime.sessionService,
      }).googleTransaction(request);
      return response;
    } catch {
      return mobileProblem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createMobileHandoffExchangePost(dependencies: {
  readonly createRuntime: () => MobileGoogleTransactionRuntime;
  readonly clientIp: (headers: Headers) => string;
}) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFromHeaders(request.headers);
    try {
      const runtime = dependencies.createRuntime();
      return createMobileRouteHandlers({
        appReturnUri: runtime.config.appReturnUri,
        clientIp: dependencies.clientIp,
        googleService: runtime.googleService,
        sessionService: runtime.sessionService,
      }).handoffExchange(request);
    } catch {
      return mobileProblem("PROVIDER_UNAVAILABLE", requestId);
    }
  };
}

export function createMobileGoogleCallbackGet(dependencies: {
  readonly appReturnUri: string;
  readonly createRuntime: () => MobileGoogleTransactionRuntime;
  readonly clientIp: (headers: Headers) => string;
}) {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFromHeaders(request.headers);
    try {
      const runtime = dependencies.createRuntime();
      return createMobileRouteHandlers({
        appReturnUri: runtime.config.appReturnUri,
        clientIp: dependencies.clientIp,
        googleService: runtime.googleService,
        sessionService: runtime.sessionService,
      }).googleCallback(request);
    } catch {
      return mobileCallbackRedirect(dependencies.appReturnUri, requestId, {
        outcome: "DENIED",
      });
    }
  };
}
