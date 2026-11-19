import {
  loadCurrentDirectoryPermissionContext,
} from "@/server/auth/directory-authority";
import { loadWebSessionRuntimeConfig } from "@/server/auth/google/config";
import {
  authenticateWebSession,
  type AuthenticatedWebSession,
  WebSessionAuthenticationError,
} from "@/server/auth/web-session";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import { classifyRequestCredential } from "@/server/http/request-security";

export type WorkspaceDepartmentKey = "SALES" | "HR" | "IT" | "FINANCE";
export type SpaceAccessScope = "WORKSPACE" | "DEPARTMENT" | "ADMIN_ONLY";

export interface WorkspaceAccessContext {
  readonly mode: "authenticated" | "preview";
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly actorLabel: string;
  readonly workspaceRole: "OWNER" | "ADMIN" | "MEMBER";
  readonly departmentKey: WorkspaceDepartmentKey | null;
  readonly userId?: string;
  readonly session?: AuthenticatedWebSession;
}

export class WorkspaceAccessError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "SERVICE_UNAVAILABLE";

  constructor(
    status: 401 | 403 | 503,
    code: "UNAUTHENTICATED" | "FORBIDDEN" | "SERVICE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "WorkspaceAccessError";
  }
}

const PREVIEW_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PREVIEW_MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000002";

export function isWorkspacePreviewModeEnabled(): boolean {
  return (
    process.env.VERCEL_ENV !== "production" &&
    process.env.UPTECH_WORKSPACE_PREVIEW === "true"
  );
}

export function getPreviewWorkspaceContext(): WorkspaceAccessContext {
  return {
    mode: "preview",
    workspaceId: PREVIEW_WORKSPACE_ID,
    membershipId: PREVIEW_MEMBERSHIP_ID,
    actorLabel: "Thành viên UPTECH",
    workspaceRole: "OWNER",
    departmentKey: null,
  };
}

export function canAccessKnowledgeSpace(
  access: WorkspaceAccessContext,
  space: Readonly<{
    accessScope?: SpaceAccessScope;
    allowedDepartmentKey?: WorkspaceDepartmentKey | null;
  }>,
): boolean {
  if (access.workspaceRole === "OWNER" || access.workspaceRole === "ADMIN") {
    return true;
  }
  const scope = space.accessScope ?? "WORKSPACE";
  if (scope === "WORKSPACE") return true;
  if (scope === "ADMIN_ONLY") return false;
  if (scope === "DEPARTMENT") {
    return (
      space.allowedDepartmentKey !== null &&
      space.allowedDepartmentKey !== undefined &&
      access.departmentKey === space.allowedDepartmentKey
    );
  }
  return false;
}

export function isSameOriginWorkspaceRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function resolveWorkspaceServerAccess(
  headers: Headers,
): Promise<WorkspaceAccessContext | null> {
  const credential = classifyRequestCredential(headers);
  if (credential.ok && credential.kind === "cookie") {
    try {
      const config = loadWebSessionRuntimeConfig();
      const pool = getRuntimeDatabasePool(config.databaseUrl);
      const session = await authenticateWebSession(headers, config.sessionPepper, pool);
      const directoryContext = await loadCurrentDirectoryPermissionContext(session, pool);
      if (directoryContext) {
        return {
          mode: "authenticated",
          workspaceId: session.context.workspaceId,
          membershipId: session.context.membershipId,
          actorLabel: session.context.actorId,
          workspaceRole: directoryContext.membershipRole,
          departmentKey: directoryContext.departmentKey,
          userId: session.context.actorId,
          session,
        };
      }
    } catch {
      // Fall through to preview mode only when explicitly enabled outside production.
    }
  }

  if (isWorkspacePreviewModeEnabled()) {
    return getPreviewWorkspaceContext();
  }

  return null;
}

export async function resolveWorkspaceApiAccess(
  request: Request,
): Promise<WorkspaceAccessContext> {
  if (!isSameOriginWorkspaceRequest(request)) {
    throw new WorkspaceAccessError(
      403,
      "FORBIDDEN",
      "Cross-origin workspace requests are rejected.",
    );
  }

  const credential = classifyRequestCredential(request.headers);
  if (credential.ok && credential.kind === "cookie") {
    try {
      const config = loadWebSessionRuntimeConfig();
      const pool = getRuntimeDatabasePool(config.databaseUrl);
      const session = await authenticateWebSession(
        request.headers,
        config.sessionPepper,
        pool,
      );
      const directoryContext = await loadCurrentDirectoryPermissionContext(session, pool);
      if (directoryContext) {
        return {
          mode: "authenticated",
          workspaceId: session.context.workspaceId,
          membershipId: session.context.membershipId,
          actorLabel: session.context.actorId,
          workspaceRole: directoryContext.membershipRole,
          departmentKey: directoryContext.departmentKey,
          userId: session.context.actorId,
          session,
        };
      }
    } catch (error) {
      if (error instanceof WebSessionAuthenticationError) {
        if (!isWorkspacePreviewModeEnabled()) {
          throw new WorkspaceAccessError(
            401,
            "UNAUTHENTICATED",
            "Valid workspace session is required.",
          );
        }
      } else if (!isWorkspacePreviewModeEnabled()) {
        throw new WorkspaceAccessError(
          503,
          "SERVICE_UNAVAILABLE",
          "Workspace session verification is temporarily unavailable.",
        );
      }
    }
  }

  if (isWorkspacePreviewModeEnabled()) {
    return getPreviewWorkspaceContext();
  }

  throw new WorkspaceAccessError(
    401,
    "UNAUTHENTICATED",
    "Valid workspace session is required.",
  );
}
