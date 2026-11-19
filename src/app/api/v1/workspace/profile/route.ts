import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../_shared";
import {
  requestTransactionContextFromSession,
  withRequestTransaction,
} from "@/server/db/core";
import { loadWebSessionRuntimeConfig } from "@/server/auth/google/config";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  if (auth.access.mode !== "authenticated" || !auth.access.session) {
    return workspaceJson(
      {
        ok: true,
        profile: null,
        sessions: [],
      },
      200,
      requestId,
    );
  }

  try {
    const config = loadWebSessionRuntimeConfig();
    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const session = auth.access.session;

    const data = await withRequestTransaction(
      requestTransactionContextFromSession(session.context, session.credentialHash),
      async (client) => {
        const res = await client.query<Record<string, unknown>>(
          "SELECT * FROM uptech.user_read_profile_and_sessions_v1()",
        );
        const row = res.rows[0];
        return {
          profile: row
            ? {
                displayName: typeof row.display_name === "string" ? row.display_name : null,
                jobTitle: typeof row.job_title === "string" ? row.job_title : null,
                phone: typeof row.phone === "string" ? row.phone : null,
                departmentOverride:
                  typeof row.department_override === "string" ? row.department_override : null,
                updatedAt:
                  row.updated_at instanceof Date
                    ? row.updated_at.toISOString()
                    : typeof row.updated_at === "string"
                      ? row.updated_at
                      : null,
              }
            : null,
          sessions: Array.isArray(row?.sessions_json) ? row.sessions_json : [],
        };
      },
      pool,
    );

    return workspaceJson({ ok: true, ...data }, 200, requestId);
  } catch {
    return workspaceJson({ ok: true, profile: null, sessions: [] }, 200, requestId);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    displayName?: unknown;
    jobTitle?: unknown;
    phone?: unknown;
    department?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return workspaceError(400, "INVALID_JSON", "Payload không hợp lệ.", requestId);
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim().slice(0, 120) : "";
  const jobTitle =
    typeof body.jobTitle === "string" ? body.jobTitle.trim().slice(0, 120) : "";
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const department =
    typeof body.department === "string" ? body.department.trim().slice(0, 80) : "";

  if (auth.access.mode !== "authenticated" || !auth.access.session) {
    return workspaceJson(
      {
        ok: true,
        persisted: "browser-only",
        profile: {
          displayName: displayName || null,
          jobTitle: jobTitle || null,
          phone: phone || null,
          departmentOverride: department || null,
          updatedAt: new Date().toISOString(),
        },
      },
      200,
      requestId,
    );
  }

  try {
    const config = loadWebSessionRuntimeConfig();
    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const session = auth.access.session;

    const saved = await withRequestTransaction(
      requestTransactionContextFromSession(session.context, session.credentialHash),
      async (client) => {
        const res = await client.query<Record<string, unknown>>(
          "SELECT * FROM uptech.user_update_profile_v1($1, $2, $3, $4)",
          [displayName, jobTitle, phone, department],
        );
        const row = res.rows[0];
        return {
          displayName: typeof row?.display_name === "string" ? row.display_name : null,
          jobTitle: typeof row?.job_title === "string" ? row.job_title : null,
          phone: typeof row?.phone === "string" ? row.phone : null,
          departmentOverride:
            typeof row?.department_override === "string" ? row.department_override : null,
          updatedAt:
            row?.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : new Date().toISOString(),
        };
      },
      pool,
    );

    return workspaceJson(
      { ok: true, persisted: "database", profile: saved },
      200,
      requestId,
    );
  } catch {
    return workspaceError(
      503,
      "PROFILE_SAVE_UNAVAILABLE",
      "Chưa thể lưu hồ sơ lên cơ sở dữ liệu (cần chạy migration 0017).",
      requestId,
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  if (auth.access.mode !== "authenticated" || !auth.access.session) {
    return workspaceError(401, "UNAUTHENTICATED", "Cần đăng nhập để quản lý phiên.", requestId);
  }

  const url = new URL(request.url);
  const allOthers = url.searchParams.get("allOthers") === "true";
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";

  if (!allOthers && !UUID_PATTERN.test(sessionId)) {
    return workspaceError(400, "INVALID_SESSION_ID", "Mã phiên không hợp lệ.", requestId);
  }

  try {
    const config = loadWebSessionRuntimeConfig();
    const pool = getRuntimeDatabasePool(config.databaseUrl);
    const session = auth.access.session;

    const result = await withRequestTransaction(
      requestTransactionContextFromSession(session.context, session.credentialHash),
      async (client) => {
        const revokedRes = await client.query<{ user_revoke_sessions_v1: number }>(
          "SELECT uptech.user_revoke_sessions_v1($1::uuid, $2::boolean, $3::uuid)",
          [allOthers ? null : sessionId, allOthers, requestId],
        );
        const stateRes = await client.query<Record<string, unknown>>(
          "SELECT * FROM uptech.user_read_profile_and_sessions_v1()",
        );
        return {
          revokedCount: Number(revokedRes.rows[0]?.user_revoke_sessions_v1 ?? 0),
          sessions: Array.isArray(stateRes.rows[0]?.sessions_json)
            ? stateRes.rows[0].sessions_json
            : [],
        };
      },
      pool,
    );

    return workspaceJson({ ok: true, ...result }, 200, requestId);
  } catch {
    return workspaceError(
      503,
      "SESSION_REVOKE_FAILED",
      "Không thể thu hồi phiên đăng nhập lúc này.",
      requestId,
    );
  }
}
