import { randomUUID } from "node:crypto";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

const SAFE_PROBLEM_DEFINITIONS = Object.freeze({
  VALIDATION_FAILED: {
    status: 400,
    title: "Validation failed",
    detail: "The request is invalid.",
  },
  UNAUTHENTICATED: {
    status: 401,
    title: "Unauthenticated",
    detail: "Authentication is required.",
  },
  ACCESS_TOKEN_EXPIRED: {
    status: 401,
    title: "Access token expired",
    detail: "The access token must be refreshed.",
  },
  SESSION_REVOKED: {
    status: 401,
    title: "Session revoked",
    detail: "The session is no longer active.",
  },
  SESSION_EXPIRED: {
    status: 401,
    title: "Session expired",
    detail: "The session has expired.",
  },
  FORBIDDEN: {
    status: 403,
    title: "Forbidden",
    detail: "The requested action is not allowed.",
  },
  PERSONAL_GOOGLE_ACCOUNT: {
    status: 403,
    title: "Google Workspace account required",
    detail: "Use the Google Workspace account provided by your organization.",
  },
  UNKNOWN_WORKSPACE: {
    status: 403,
    title: "Unknown workspace",
    detail: "The organization is not registered.",
  },
  USER_NOT_PROVISIONED: {
    status: 403,
    title: "Access not granted",
    detail: "Access has not been granted for this account.",
  },
  USER_SUSPENDED: {
    status: 403,
    title: "Account suspended",
    detail: "The account is suspended.",
  },
  WORKSPACE_SUSPENDED: {
    status: 403,
    title: "Workspace suspended",
    detail: "The organization workspace is suspended.",
  },
  POLICY_OR_DEVICE_BLOCKED: {
    status: 403,
    title: "Access blocked",
    detail: "The organization policy does not allow this sign-in.",
  },
  GOOGLE_CANCELLED: {
    status: 400,
    title: "Google sign-in cancelled",
    detail: "Google sign-in was not completed.",
  },
  AUTH_ERROR: {
    status: 401,
    title: "Authentication error",
    detail: "The sign-in request could not be verified.",
  },
  NOT_FOUND: {
    status: 404,
    title: "Not found",
    detail: "The requested resource was not found.",
  },
  CONFLICT: {
    status: 409,
    title: "Conflict",
    detail: "The request conflicts with the current state.",
  },
  RATE_LIMITED: {
    status: 429,
    title: "Rate limited",
    detail: "Too many requests.",
  },
  INTERNAL_ERROR: {
    status: 500,
    title: "Internal error",
    detail: "The request could not be completed.",
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    title: "Provider unavailable",
    detail: "A required provider is unavailable.",
  },
  SYNC_DEGRADED: {
    status: 503,
    title: "Sync degraded",
    detail: "Required synchronized data is unavailable or stale.",
  },
} as const);

export type ProblemCode = keyof typeof SAFE_PROBLEM_DEFINITIONS;

export interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly request_id: string;
}

export function createRequestId(): string {
  return randomUUID();
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export function requestIdFromHeaders(headers: Headers): string {
  const trustedBoundaryId = headers.get("x-uptech-request-id");
  return trustedBoundaryId !== null && isRequestId(trustedBoundaryId)
    ? trustedBoundaryId
    : createRequestId();
}

export function createSafeProblem(
  code: ProblemCode,
  requestId: string = createRequestId(),
): ProblemDocument {
  if (!isRequestId(requestId)) {
    throw new TypeError("Request identifier is invalid");
  }
  const definition = SAFE_PROBLEM_DEFINITIONS[code];
  return Object.freeze({
    type: `urn:uptech:problem:${code.toLowerCase()}`,
    title: definition.title,
    status: definition.status,
    code,
    detail: definition.detail,
    request_id: requestId,
  });
}

export function safeProblemFromUnknown(error: unknown): ProblemDocument {
  void error;
  return createSafeProblem("INTERNAL_ERROR");
}

export function problemResponse(problem: ProblemDocument): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": PROBLEM_CONTENT_TYPE,
      "X-Request-Id": problem.request_id,
    },
  });
}
