import {
  createSafeProblem,
  PROBLEM_CONTENT_TYPE,
  type ProblemCode,
} from "../../http/problem.ts";
import type { MobileAuthUiCategory } from "./google-service.ts";
import { MobileSessionServiceError } from "./session-service.ts";

export type MobileRecoveryActionId =
  | "OPEN_WORKSPACE_SETUP_IN_BROWSER"
  | "SWITCH_GOOGLE_ACCOUNT"
  | "OPEN_ENTERPRISE_LOGIN_HELP"
  | "CONTACT_WORKSPACE_ADMIN"
  | "CONTACT_UPTECH"
  | "RETRY_GOOGLE_LOGIN";

const MOBILE_RECOVERY_ACTIONS = Object.freeze({
  PERSONAL_GOOGLE_ACCOUNT: ["SWITCH_GOOGLE_ACCOUNT", "OPEN_ENTERPRISE_LOGIN_HELP"],
  UNKNOWN_WORKSPACE: ["OPEN_WORKSPACE_SETUP_IN_BROWSER", "SWITCH_GOOGLE_ACCOUNT"],
  USER_NOT_PROVISIONED: ["CONTACT_WORKSPACE_ADMIN", "SWITCH_GOOGLE_ACCOUNT"],
  USER_SUSPENDED: ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_WORKSPACE_ADMIN"],
  WORKSPACE_SUSPENDED: ["CONTACT_UPTECH", "SWITCH_GOOGLE_ACCOUNT"],
  SESSION_REVOKED: ["RETRY_GOOGLE_LOGIN", "SWITCH_GOOGLE_ACCOUNT"],
  SESSION_EXPIRED: ["RETRY_GOOGLE_LOGIN", "SWITCH_GOOGLE_ACCOUNT"],
  POLICY_OR_DEVICE_BLOCKED: ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_WORKSPACE_ADMIN"],
  GOOGLE_CANCELLED: ["RETRY_GOOGLE_LOGIN", "SWITCH_GOOGLE_ACCOUNT"],
  PROVIDER_UNAVAILABLE: ["RETRY_GOOGLE_LOGIN", "CONTACT_UPTECH"],
  OFFLINE: ["RETRY_GOOGLE_LOGIN", "CONTACT_UPTECH"],
  AUTH_ERROR: ["RETRY_GOOGLE_LOGIN", "CONTACT_UPTECH"],
} as const satisfies Readonly<Record<MobileAuthUiCategory, readonly MobileRecoveryActionId[]>>);

function mobileProblemDocument(code: ProblemCode, requestId: string) {
  const problem = createSafeProblem(code, requestId);
  return Object.freeze({
    type: problem.type,
    title: problem.title,
    status: problem.status,
    code: problem.code,
    detail: problem.detail,
    request_id: problem.request_id,
  });
}

function mobileProblemResponse(document: ReturnType<typeof mobileProblemDocument> & {
  readonly recovery_actions?: readonly MobileRecoveryActionId[];
  readonly web_setup_url?: string;
}): Response {
  return new Response(JSON.stringify(document), {
    status: document.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": PROBLEM_CONTENT_TYPE,
      "X-Request-Id": document.request_id,
    },
  });
}

function trustedWorkspaceSetupUrl(appReturnUri: string): string {
  const configured = new URL(appReturnUri);
  if (configured.protocol !== "https:" || configured.username !== "" ||
      configured.password !== "" || configured.port !== "" ||
      configured.hash !== "" || configured.search !== "" ||
      configured.pathname !== "/auth/mobile/callback") {
    throw new TypeError("Invalid configured Mobile application origin");
  }
  return new URL("/login?intent=workspace_setup", configured.origin).href;
}

export async function boundedJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim();
  const length = Number(request.headers.get("content-length") ?? "0");
  if (type !== "application/json" || !Number.isFinite(length) || length > 4_096) {
    throw new TypeError("Invalid request body");
  }
  const text = await request.text();
  if (text.length < 2 || Buffer.byteLength(text, "utf8") > 4_096) {
    throw new TypeError("Invalid request body");
  }
  return JSON.parse(text) as unknown;
}

export function mobileJson(value: unknown, requestId: string, status = 200) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store, max-age=0", Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId,
  } });
}

export function mobileProblem(code: ProblemCode, requestId: string) {
  return mobileProblemResponse(mobileProblemDocument(code, requestId));
}

export function mobileAuthProblem(
  category: MobileAuthUiCategory,
  requestId: string,
): Response {
  const code: ProblemCode = category === "OFFLINE"
    ? "PROVIDER_UNAVAILABLE"
    : category;
  return mobileProblem(code, requestId);
}

export function mobileAuthenticatedDenialProblem(
  category: MobileAuthUiCategory,
  requestId: string,
  appReturnUri: string,
): Response {
  const actions = MOBILE_RECOVERY_ACTIONS[category];
  if (actions === undefined) {
    throw new TypeError("Invalid Mobile recovery category");
  }
  const code: ProblemCode = category === "OFFLINE"
    ? "PROVIDER_UNAVAILABLE"
    : category;
  const document = {
    ...mobileProblemDocument(code, requestId),
    recovery_actions: actions,
    ...(category === "UNKNOWN_WORKSPACE"
      ? { web_setup_url: trustedWorkspaceSetupUrl(appReturnUri) }
      : {}),
  };
  const response = mobileProblemResponse(document);
  response.headers.set("X-Uptech-Mobile-Handoff-Outcome", "ACCESS_DENIED");
  return response;
}

export function mobileSessionProblem(error: unknown, requestId: string): Response {
  return mobileProblem(
    error instanceof MobileSessionServiceError ? error.code : "PROVIDER_UNAVAILABLE",
    requestId,
  );
}

export function mobileCallbackRedirect(
  appReturnUri: string,
  requestId: string,
  result:
    | { readonly outcome: "HANDOFF"; readonly handoffCode: string }
    | { readonly outcome: "DENIED" },
): Response {
  const location = new URL(appReturnUri);
  if (result.outcome === "HANDOFF") {
    location.searchParams.set("handoff", result.handoffCode);
  }
  location.searchParams.set("request_id", requestId);
  return new Response(null, { status: 303, headers: {
    "Cache-Control": "no-store, max-age=0",
    Location: location.href,
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  } });
}
