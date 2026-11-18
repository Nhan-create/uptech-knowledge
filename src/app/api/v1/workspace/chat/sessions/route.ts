import {
  deletePersistedChatSession,
  listPersistedChatSessions,
  updatePersistedTurnFeedback,
} from "@/server/knowledge/repository";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const sessions = await listPersistedChatSessions(auth.access);
  return workspaceJson({ ok: true, sessions }, 200, requestId);
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: { sessionId?: unknown; turnId?: unknown; feedback?: unknown };
  try {
    body = (await request.json()) as {
      sessionId?: unknown;
      turnId?: unknown;
      feedback?: unknown;
    };
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
  const feedback =
    body.feedback === "up" || body.feedback === "down" ? body.feedback : null;

  if (!sessionId || !turnId) {
    return workspaceError(
      400,
      "INVALID_PARAMETERS",
      "sessionId and turnId are required.",
      requestId,
    );
  }

  const session = await updatePersistedTurnFeedback(auth.access, {
    sessionId,
    turnId,
    feedback,
  });

  if (!session) {
    return workspaceError(404, "NOT_FOUND", "Session not found.", requestId);
  }

  return workspaceJson({ ok: true, session }, 200, requestId);
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("id")?.trim() ?? "";
  if (!sessionId) {
    return workspaceError(
      400,
      "INVALID_PARAMETERS",
      "Query parameter 'id' is required.",
      requestId,
    );
  }

  const deleted = await deletePersistedChatSession(auth.access, sessionId);
  if (!deleted) {
    return workspaceError(404, "NOT_FOUND", "Session not found.", requestId);
  }

  return workspaceJson({ ok: true, deletedId: sessionId }, 200, requestId);
}
