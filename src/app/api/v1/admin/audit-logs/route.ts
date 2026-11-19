import {
  adminError,
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
} from "@/server/admin/auth";
import {
  loadAdminAuditEvents,
  recordAuditExportEvent,
} from "@/server/admin/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const format = url.searchParams.get("format")?.trim().toLowerCase() ?? "json";
  const outcome = url.searchParams.get("outcome")?.trim().toUpperCase() || null;
  const search = url.searchParams.get("q")?.trim() || null;
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;

  try {
    const bundle = await loadAdminAuditEvents(auth.admin, {
      limit,
      outcome: outcome && ["SUCCEEDED", "DENIED", "FAILED"].includes(outcome) ? outcome : null,
      search,
    });

    if (format === "csv") {
      if (!bundle.auditExportEnabled) {
        return adminError(
          403,
          "EXPORT_DISABLED",
          "Tổ chức hiện đang tắt quyền xuất CSV nhật ký kiểm toán trong mục Thiết lập.",
          requestId,
        );
      }

      await recordAuditExportEvent(auth.admin, bundle.events.length).catch(() => undefined);

      const header = [
        "occurred_at",
        "action",
        "outcome",
        "actor_kind",
        "actor_email",
        "target_type",
        "target_id",
        "request_id",
        "metadata",
      ].join(",");

      const lines = bundle.events.map((event) =>
        [
          csvCell(event.occurredAt),
          csvCell(event.action),
          csvCell(event.outcome),
          csvCell(event.actorKind),
          csvCell(event.actorEmail ?? event.actorId ?? ""),
          csvCell(event.targetType),
          csvCell(event.targetId ?? ""),
          csvCell(event.requestId),
          csvCell(JSON.stringify(event.metadata)),
        ].join(","),
      );

      const dateTag = new Date().toISOString().slice(0, 10);
      const csvBody = `\uFEFF${[header, ...lines].join("\r\n")}`;
      return new Response(csvBody, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="uptech-audit-logs-${dateTag}.csv"`,
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": requestId,
        },
      });
    }

    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải nhật ký kiểm toán của tổ chức.",
    );
  }
}
