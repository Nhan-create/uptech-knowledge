import {
  adminError,
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
} from "@/server/admin/auth";
import {
  inviteWorkspaceMember,
  loadAdminUsersBundle,
  resolveAccessRequest,
  revokeWorkspaceInvite,
  sendWorkspaceInviteEmailIfConfigured,
  updateWorkspaceMember,
} from "@/server/admin/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await loadAdminUsersBundle(auth.admin);
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải danh sách người dùng và danh bạ của tổ chức.",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    email?: unknown;
    role?: unknown;
    departmentKey?: unknown;
    note?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError(400, "INVALID_JSON", "Payload gửi lên không hợp lệ.", requestId);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return adminError(400, "INVALID_EMAIL", "Vui lòng nhập email công ty hợp lệ.", requestId);
  }

  const role = body.role === "ADMIN" ? "ADMIN" : "MEMBER";
  const departmentKey =
    typeof body.departmentKey === "string" && body.departmentKey.trim().length > 0
      ? body.departmentKey.trim().toUpperCase()
      : null;
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 240)
      : null;

  try {
    const invite = await inviteWorkspaceMember(auth.admin, {
      email,
      role,
      departmentKey,
      note,
    });

    const origin = new URL(request.url).origin;
    const loginUrl = `${origin}/login`;
    const emailDelivery = await sendWorkspaceInviteEmailIfConfigured({
      toEmail: invite.email,
      role: invite.role,
      organizationDomain: invite.email.split("@")[1] ?? null,
      loginUrl,
      note,
    });

    const bundle = await loadAdminUsersBundle(auth.admin);
    return adminJson(
      {
        ok: true,
        invite,
        emailDelivery,
        loginUrl,
        ...bundle,
      },
      201,
      requestId,
    );
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tạo lời mời thành viên.",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    action?: unknown;
    membershipId?: unknown;
    role?: unknown;
    status?: unknown;
    requestRowId?: unknown;
    decision?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError(400, "INVALID_JSON", "Payload gửi lên không hợp lệ.", requestId);
  }

  try {
    if (body.action === "resolve_access_request") {
      const requestRowId =
        typeof body.requestRowId === "string" ? body.requestRowId.trim() : "";
      if (!UUID_PATTERN.test(requestRowId)) {
        return adminError(400, "INVALID_REQUEST_ID", "Mã yêu cầu truy cập không hợp lệ.", requestId);
      }
      const decision =
        body.decision === "APPROVE"
          ? "APPROVE"
          : body.decision === "REJECT"
            ? "REJECT"
            : null;
      if (!decision) {
        return adminError(400, "INVALID_DECISION", "Quyết định phải là APPROVE hoặc REJECT.", requestId);
      }
      const role = body.role === "ADMIN" ? "ADMIN" : "MEMBER";
      const resolution = await resolveAccessRequest(auth.admin, {
        requestRowId,
        decision,
        role,
      });
      const bundle = await loadAdminUsersBundle(auth.admin);
      return adminJson({ ok: true, resolution, ...bundle }, 200, requestId);
    }

    const membershipId =
      typeof body.membershipId === "string" ? body.membershipId.trim() : "";
    if (!UUID_PATTERN.test(membershipId)) {
      return adminError(400, "INVALID_MEMBERSHIP_ID", "Mã thành viên không hợp lệ.", requestId);
    }

    const updated = await updateWorkspaceMember(auth.admin, {
      membershipId,
      role: typeof body.role === "string" ? body.role.trim().toUpperCase() : undefined,
      status: typeof body.status === "string" ? body.status.trim().toUpperCase() : undefined,
    });
    const bundle = await loadAdminUsersBundle(auth.admin);
    return adminJson({ ok: true, updated, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể cập nhật thông tin thành viên.",
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const inviteId = url.searchParams.get("inviteId")?.trim() ?? "";
  if (!UUID_PATTERN.test(inviteId)) {
    return adminError(400, "INVALID_INVITE_ID", "Mã lời mời không hợp lệ.", requestId);
  }

  try {
    const revoked = await revokeWorkspaceInvite(auth.admin, inviteId);
    if (!revoked) {
      return adminError(404, "NOT_FOUND", "Lời mời không tồn tại hoặc đã được xử lý.", requestId);
    }
    const bundle = await loadAdminUsersBundle(auth.admin);
    return adminJson({ ok: true, revoked: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(error, requestId, "Không thể thu hồi lời mời.");
  }
}
