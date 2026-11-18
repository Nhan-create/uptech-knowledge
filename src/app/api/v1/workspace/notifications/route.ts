import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "@/app/api/v1/workspace/_shared";
import {
  clearWorkspaceNotifications,
  listWorkspaceNotifications,
  markWorkspaceNotificationsRead,
} from "@/server/knowledge/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const notifications = await listWorkspaceNotifications(auth.access);
  const unreadCount = notifications.filter((item) => item.unread).length;
  return workspaceJson({ notifications, unreadCount }, 200, requestId);
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: { notificationId?: unknown; markAll?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return workspaceError(400, "INVALID_JSON", "Payload không hợp lệ.", requestId);
  }

  const markAll = body.markAll === true;
  const notificationId =
    typeof body.notificationId === "string" && body.notificationId.trim().length > 0
      ? body.notificationId.trim()
      : undefined;

  if (!markAll && !notificationId) {
    return workspaceError(
      400,
      "MISSING_TARGET",
      "Cần notificationId hoặc markAll=true.",
      requestId,
    );
  }

  const notifications = await markWorkspaceNotificationsRead(auth.access, {
    notificationId,
    markAll,
  });
  const unreadCount = notifications.filter((item) => item.unread).length;
  return workspaceJson({ notifications, unreadCount }, 200, requestId);
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  await clearWorkspaceNotifications(auth.access);
  return workspaceJson({ ok: true, notifications: [], unreadCount: 0 }, 200, requestId);
}
