import { randomUUID } from "node:crypto";

import {
  resolveWorkspaceApiAccess,
  WorkspaceAccessError,
  type WorkspaceAccessContext,
} from "@/server/knowledge/access-context";

export function workspaceJson(
  body: unknown,
  status: number,
  requestId: string,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

export function workspaceError(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return workspaceJson(
    {
      ok: false,
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
    requestId,
  );
}

export function resolveRequestId(request: Request): string {
  return request.headers.get("x-uptech-request-id") ?? randomUUID();
}

export async function authorizeWorkspaceApi(
  request: Request,
  requestId: string,
): Promise<
  | { readonly ok: true; readonly access: WorkspaceAccessContext }
  | { readonly ok: false; readonly response: Response }
> {
  try {
    const access = await resolveWorkspaceApiAccess(request);
    return { ok: true, access };
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return {
        ok: false,
        response: workspaceError(error.status, error.code, error.message, requestId),
      };
    }
    return {
      ok: false,
      response: workspaceError(
        503,
        "SERVICE_UNAVAILABLE",
        "Workspace authorization unavailable.",
        requestId,
      ),
    };
  }
}
