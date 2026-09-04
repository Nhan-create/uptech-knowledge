import { randomUUID } from "node:crypto";

import {
  resolveRecoveryActions,
  type RecoveryActionId,
  type RecoveryAuthority,
  type RecoveryState,
} from "../auth/recovery-actions.ts";

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
  SUPER_ADMIN_REQUIRED: {
    status: 403,
    title: "Super administrator required",
    detail: "A Google Workspace super administrator must complete this step.",
  },
  DELEGATED_ADMIN_UNSUPPORTED: {
    status: 403,
    title: "Super administrator required",
    detail: "A Google Workspace super administrator must complete this step.",
  },
  GOOGLE_CONSENT_CANCELLED: {
    status: 400,
    title: "Google consent cancelled",
    detail: "Google Workspace consent was not completed.",
  },
  DIRECTORY_SCOPE_REQUIRED: {
    status: 403,
    title: "Directory permission required",
    detail: "Additional Google Workspace permission is required.",
  },
  CONSENT_ACCOUNT_MISMATCH: {
    status: 403,
    title: "Google account mismatch",
    detail: "Use the Google Workspace account for this organization.",
  },
  DOMAIN_NOT_VERIFIED: {
    status: 403,
    title: "Domain verification required",
    detail: "Google Workspace domain verification is required.",
  },
  GOOGLE_ORGANIZATION_MISMATCH: {
    status: 403,
    title: "Google organization mismatch",
    detail: "The Google Workspace organization does not match.",
  },
  ORGANIZATION_ALREADY_REGISTERED: {
    status: 409,
    title: "Organization already registered",
    detail: "This organization has already been registered.",
  },
  ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE: {
    status: 409,
    title: "Organization already registered",
    detail: "This organization has already been registered.",
  },
  DIRECTORY_BOOTSTRAP_SYNC_PENDING: {
    status: 409,
    title: "Directory setup in progress",
    detail: "Google Workspace directory setup is still in progress.",
  },
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: {
    status: 503,
    title: "Directory setup retry required",
    detail: "Google Workspace directory setup can be retried.",
  },
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: {
    status: 503,
    title: "Directory setup needs support",
    detail: "Google Workspace directory setup needs support.",
  },
  ACCESS_MAPPING_CONFLICT: {
    status: 409,
    title: "Access mapping conflict",
    detail: "Access cannot be determined for this account.",
  },
  USER_REMOVED: {
    status: 403,
    title: "Account removed",
    detail: "This account no longer has access.",
  },
  DIRECTORY_SYNC_PENDING: {
    status: 503,
    title: "Directory synchronization pending",
    detail: "Google Workspace directory synchronization is pending.",
  },
  DIRECTORY_STALE: {
    status: 503,
    title: "Directory data stale",
    detail: "Google Workspace directory data is unavailable or stale.",
  },
  DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE: {
    status: 503,
    title: "Directory data stale",
    detail: "Google Workspace directory data is unavailable or stale.",
  },
  ONBOARDING_EXPIRED: {
    status: 401,
    title: "Onboarding expired",
    detail: "The organization setup session has expired.",
  },
} as const);

export type ProblemCode = keyof typeof SAFE_PROBLEM_DEFINITIONS;

const RECOVERY_STATE_BY_PROBLEM_CODE = Object.freeze({
  VALIDATION_FAILED: "INTERNAL_ERROR",
  UNAUTHENTICATED: "SESSION_EXPIRED",
  ACCESS_TOKEN_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  FORBIDDEN: "FORBIDDEN",
  PERSONAL_GOOGLE_ACCOUNT: "PERSONAL_GOOGLE_ACCOUNT",
  UNKNOWN_WORKSPACE: "UNKNOWN_WORKSPACE",
  USER_NOT_PROVISIONED: "USER_NOT_PROVISIONED",
  USER_SUSPENDED: "USER_SUSPENDED",
  WORKSPACE_SUSPENDED: "WORKSPACE_SUSPENDED",
  POLICY_OR_DEVICE_BLOCKED: "FORBIDDEN",
  GOOGLE_CANCELLED: "PROVIDER_UNAVAILABLE",
  AUTH_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "INTERNAL_ERROR",
  CONFLICT: "INTERNAL_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  SYNC_DEGRADED: "DIRECTORY_STALE",
  SUPER_ADMIN_REQUIRED: "SUPER_ADMIN_REQUIRED",
  DELEGATED_ADMIN_UNSUPPORTED: "DELEGATED_ADMIN_UNSUPPORTED",
  GOOGLE_CONSENT_CANCELLED: "GOOGLE_CONSENT_CANCELLED",
  DIRECTORY_SCOPE_REQUIRED: "DIRECTORY_SCOPE_REQUIRED",
  CONSENT_ACCOUNT_MISMATCH: "CONSENT_ACCOUNT_MISMATCH",
  DOMAIN_NOT_VERIFIED: "DOMAIN_NOT_VERIFIED",
  GOOGLE_ORGANIZATION_MISMATCH: "GOOGLE_ORGANIZATION_MISMATCH",
  ORGANIZATION_ALREADY_REGISTERED: "ORGANIZATION_ALREADY_REGISTERED",
  ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE: "ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE",
  DIRECTORY_BOOTSTRAP_SYNC_PENDING: "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
  ACCESS_MAPPING_CONFLICT: "ACCESS_MAPPING_CONFLICT",
  USER_REMOVED: "USER_REMOVED",
  DIRECTORY_SYNC_PENDING: "DIRECTORY_SYNC_PENDING",
  DIRECTORY_STALE: "DIRECTORY_STALE",
  DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE: "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE",
  ONBOARDING_EXPIRED: "ONBOARDING_EXPIRED",
} as const satisfies Readonly<Record<ProblemCode, RecoveryState>>);

export interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly request_id: string;
  readonly recovery_actions: readonly RecoveryActionId[];
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
  authority: RecoveryAuthority | null = null,
): ProblemDocument {
  if (!isRequestId(requestId)) {
    throw new TypeError("Request identifier is invalid");
  }
  const definition = SAFE_PROBLEM_DEFINITIONS[code];
  const recoveryActions = Object.freeze(
    resolveRecoveryActions({
      state: RECOVERY_STATE_BY_PROBLEM_CODE[code],
      authority,
    }).map((action) => action.id),
  );
  return Object.freeze({
    type: `urn:uptech:problem:${code.toLowerCase()}`,
    title: definition.title,
    status: definition.status,
    code,
    detail: definition.detail,
    request_id: requestId,
    recovery_actions: recoveryActions,
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
