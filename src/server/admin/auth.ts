import { randomUUID } from "node:crypto";

import { requireCurrentDirectoryAuthority } from "@/server/auth/directory-authority";
import { loadWebSessionRuntimeConfig } from "@/server/auth/google/config";
import {
  authenticateWebSession,
  type AuthenticatedWebSession,
  WebSessionAuthenticationError,
} from "@/server/auth/web-session";
import { type DatabasePool } from "@/server/db/core";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import { classifyRequestCredential } from "@/server/http/request-security";
import { isWorkspacePreviewModeEnabled } from "@/server/knowledge/access-context";

export interface AdminApiContext {
  readonly session: AuthenticatedWebSession;
  readonly pool: Pick<DatabasePool, "connect" | "query">;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly membershipId: string;
  readonly sessionId: string;
  readonly role: "OWNER" | "ADMIN";
  readonly requestId: string;
  readonly isPreviewMode?: boolean;
}

function createPreviewAdminContext(requestId: string): AdminApiContext {
  const workspaceId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const membershipId = "00000000-0000-4000-8000-000000000003";
  const sessionId = "00000000-0000-4000-8000-000000000004";
  return Object.freeze({
    session: {
      credentialHash: new Uint8Array(32),
      context: {
        workspaceId,
        actorId,
        membershipId,
        sessionId,
        workspaceRole: "OWNER" as const,
      },
    } as unknown as AuthenticatedWebSession,
    pool: {
      connect: async () => {
        throw new Error("Preview mode pool");
      },
      query: async () => {
        throw new Error("Preview mode pool");
      },
    } as unknown as Pick<DatabasePool, "connect" | "query">,
    workspaceId,
    actorId,
    membershipId,
    sessionId,
    role: "OWNER",
    requestId,
    isPreviewMode: true,
  });
}

export function resolveAdminRequestId(request: Request): string {
  return request.headers.get("x-uptech-request-id") ?? randomUUID();
}

export function adminJson(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Request-Id", requestId);
  return Response.json(body, { status, headers });
}

export function adminError(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return adminJson(
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

export function isSameOriginAdminRequest(request: Request): boolean {
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

export async function resolveAdminContextFromHeaders(
  headers: Headers,
  requestId: string = randomUUID(),
): Promise<AdminApiContext | null> {
  try {
    const config = loadWebSessionRuntimeConfig();
    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const session = await authenticateWebSession(headers, config.sessionPepper, pool);
    const role = session.context.workspaceRole;
    if (role !== "OWNER" && role !== "ADMIN") {
      return null;
    }
    const current = await requireCurrentDirectoryAuthority(session, pool);
    if (!current) {
      return null;
    }
    return Object.freeze({
      session,
      pool,
      workspaceId: session.context.workspaceId,
      actorId: session.context.actorId,
      membershipId: session.context.membershipId,
      sessionId: session.context.sessionId,
      role,
      requestId,
    });
  } catch {
    if (isWorkspacePreviewModeEnabled()) {
      return createPreviewAdminContext(requestId);
    }
    return null;
  }
}

export async function authorizeAdminApi(
  request: Request,
  requestId: string,
): Promise<
  | { readonly ok: true; readonly admin: AdminApiContext }
  | { readonly ok: false; readonly response: Response }
> {
  if (!isSameOriginAdminRequest(request)) {
    return {
      ok: false,
      response: adminError(
        403,
        "FORBIDDEN",
        "Yêu cầu cross-origin không được phép truy cập khu vực quản trị.",
        requestId,
      ),
    };
  }

  const credential = classifyRequestCredential(request.headers);
  if (!credential.ok || credential.kind !== "cookie") {
    if (isWorkspacePreviewModeEnabled()) {
      return { ok: true, admin: createPreviewAdminContext(requestId) };
    }
    return {
      ok: false,
      response: adminError(
        401,
        "UNAUTHENTICATED",
        "Vui lòng đăng nhập lại bằng tài khoản quản trị để tiếp tục.",
        requestId,
      ),
    };
  }

  try {
    const config = loadWebSessionRuntimeConfig();
    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const session = await authenticateWebSession(
      request.headers,
      config.sessionPepper,
      pool,
    );

    const role = session.context.workspaceRole;
    if (role !== "OWNER" && role !== "ADMIN") {
      return {
        ok: false,
        response: adminError(
          403,
          "FORBIDDEN",
          "Tài khoản hiện tại không có quyền quản trị tổ chức.",
          requestId,
        ),
      };
    }

    const current = await requireCurrentDirectoryAuthority(session, pool);
    if (!current) {
      return {
        ok: false,
        response: adminError(
          403,
          "AUTHORITY_NOT_CURRENT",
          "Quyền quản trị chưa được xác nhận đồng bộ mới nhất. Vui lòng đăng nhập lại.",
          requestId,
        ),
      };
    }

    return {
      ok: true,
      admin: Object.freeze({
        session,
        pool,
        workspaceId: session.context.workspaceId,
        actorId: session.context.actorId,
        membershipId: session.context.membershipId,
        sessionId: session.context.sessionId,
        role,
        requestId,
      }),
    };
  } catch (error) {
    if (isWorkspacePreviewModeEnabled()) {
      return { ok: true, admin: createPreviewAdminContext(requestId) };
    }
    if (error instanceof WebSessionAuthenticationError) {
      return {
        ok: false,
        response: adminError(
          401,
          "UNAUTHENTICATED",
          "Phiên đăng nhập đã hết hạn hoặc không hợp lệ.",
          requestId,
        ),
      };
    }
    return {
      ok: false,
      response: adminError(
        503,
        "SERVICE_UNAVAILABLE",
        "Hệ thống xác thực quản trị tạm thời không khả dụng.",
        requestId,
      ),
    };
  }
}

export function mapAdminDbError(
  error: unknown,
  requestId: string,
  fallbackMessage: string,
): Response {
  const pgError = error as {
    code?: unknown;
    message?: unknown;
    routine?: unknown;
    table?: unknown;
    column?: unknown;
    constraint?: unknown;
  } | null;
  const code = typeof pgError?.code === "string" ? pgError.code : "";
  const message = typeof pgError?.message === "string" ? pgError.message : "";
  const safeToken = (value: unknown): string | undefined =>
    typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value)
      ? value
      : undefined;

  console.error(
    JSON.stringify({
      event: "UPTECH_ADMIN_DB_ERROR_V1",
      request_id: requestId,
      ...(code ? { pg_code: code } : {}),
      ...(safeToken(pgError?.routine) ? { pg_routine: safeToken(pgError?.routine) } : {}),
      ...(safeToken(pgError?.table) ? { pg_table: safeToken(pgError?.table) } : {}),
      ...(safeToken(pgError?.column) ? { pg_column: safeToken(pgError?.column) } : {}),
      ...(safeToken(pgError?.constraint)
        ? { pg_constraint: safeToken(pgError?.constraint) }
        : {}),
    }),
  );

  if (code === "57P01" || code === "57P02" || code === "57P03") {
    return adminError(
      503,
      "SERVICE_UNAVAILABLE",
      "Kết nối cơ sở dữ liệu vừa khởi động lại. Vui lòng thử lại.",
      requestId,
    );
  }

  if (code === "42501") {
    return adminError(
      403,
      "FORBIDDEN",
      message.includes("owner")
        ? "Chỉ Chủ sở hữu (OWNER) mới được phép thực hiện thao tác này."
        : "Không đủ quyền quản trị để thực hiện thao tác này.",
      requestId,
    );
  }
  if (code === "P0002") {
    return adminError(404, "NOT_FOUND", "Không tìm thấy bản ghi yêu cầu trong tổ chức.", requestId);
  }
  if (code === "22023") {
    if (message.includes("email domain")) {
      return adminError(
        400,
        "INVALID_DOMAIN",
        "Email được mời phải thuộc tên miền đã xác minh của tổ chức.",
        requestId,
      );
    }
    if (message.includes("org_unit")) {
      return adminError(
        400,
        "INVALID_ORG_UNIT",
        "Giá trị ORG_UNIT phải là mã Google OrgUnit ID (không bắt đầu bằng dấu /).",
        requestId,
      );
    }
    return adminError(400, "VALIDATION_ERROR", "Dữ liệu gửi lên không hợp lệ.", requestId);
  }
  if (code === "55000") {
    if (message.includes("last active owner")) {
      return adminError(
        409,
        "LAST_OWNER_PROTECTED",
        "Không thể hạ quyền hoặc tạm khóa Chủ sở hữu (OWNER) duy nhất của tổ chức.",
        requestId,
      );
    }
    if (message.includes("published Google Directory")) {
      return adminError(
        409,
        "DIRECTORY_SYNC_REQUIRED",
        "Cần hoàn tất đồng bộ danh bạ Google Directory hợp lệ trước khi bật chế độ GOOGLE_GROUP_CONTROLLED.",
        requestId,
      );
    }
    return adminError(409, "CONFLICT", "Trạng thái dữ liệu hiện tại không cho phép thao tác này.", requestId);
  }
  if (code === "23505") {
    return adminError(
      409,
      "ALREADY_EXISTS",
      "Bản ghi hoặc tài khoản này đã tồn tại trong hệ thống.",
      requestId,
    );
  }
  if (code === "42883" || code === "42P01") {
    return adminError(
      503,
      "SCHEMA_UPGRADE_REQUIRED",
      "Cơ sở dữ liệu cần cập nhật migration quản trị (0016) để kích hoạt đầy đủ tính năng này.",
      requestId,
    );
  }

  return adminError(500, "INTERNAL_ERROR", fallbackMessage, requestId);
}
