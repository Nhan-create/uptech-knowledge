"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Download,
  FileClock,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminAuditEventRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";

interface AuditLogsApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly events: readonly AdminAuditEventRecord[];
  readonly auditExportEnabled: boolean;
  readonly error?: { readonly message?: string };
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AdminAuditLogsClient() {
  const [data, setData] = useState<AuditLogsApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("ALL");
  const [limit, setLimit] = useState("100");

  const buildQueryString = useCallback(
    (format?: "csv") => {
      const params = new URLSearchParams();
      params.set("limit", limit);
      if (outcome !== "ALL") params.set("outcome", outcome);
      if (search.trim()) params.set("q", search.trim());
      if (format === "csv") params.set("format", "csv");
      return params.toString();
    },
    [limit, outcome, search],
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch(`/api/v1/admin/audit-logs?${buildQueryString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as AuditLogsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể tải nhật ký kiểm toán.");
        return;
      }
      setData(payload);
    } catch {
      setErrorMsg("Mất kết nối tới máy chủ quản trị.");
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const exportUrl = `/api/v1/admin/audit-logs?${buildQueryString("csv")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
            Truy vết &amp; tuân thủ bảo mật
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
            Nhật ký kiểm toán
          </h2>
          <p className="mt-1 text-sm text-[#52607A]">
            Ghi nhận bất biến mọi sự kiện đăng nhập, phân quyền, thay đổi thành viên và cấu hình tổ chức từ bảng <code>uptech.audit_events</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchLogs()}
            disabled={loading}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#0D1321]/12 bg-white px-3.5 text-sm font-semibold text-[#323B4D] hover:bg-[#F8FAFC] disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`} />
            <span>Làm mới</span>
          </button>

          {data?.auditExportEnabled !== false ? (
            <a
              href={exportUrl}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1B44FF] px-4 text-sm font-semibold text-white hover:bg-[#1635C7]"
            >
              <Download aria-hidden="true" className="size-4" />
              <span>Xuất CSV</span>
            </a>
          ) : (
            <span className="rounded-xl border border-[#0D1321]/10 bg-slate-50 px-3.5 py-2 text-xs font-medium text-[#64748B]">
              Xuất CSV đang tắt trong Thiết lập
            </span>
          )}
        </div>
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      <Card className="p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void fetchLogs();
          }}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-[#0D1321]/8 pb-4"
        >
          <div className="flex items-center gap-2">
            <FileClock aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <h3 className="text-base font-bold text-[#0D1321]">
              Sự kiện thực tế ({data?.events.length ?? 0})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#64748B]"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm hành động, email, request ID..."
                className="w-60 rounded-xl border border-[#0D1321]/12 bg-[#F8FAFC] py-2 pl-9 pr-3 text-xs text-[#0D1321] focus:border-[#1B44FF] focus:bg-white focus:outline-none"
              />
            </div>

            <select
              aria-label="Lọc kết quả"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="rounded-xl border border-[#0D1321]/12 bg-white px-3 py-2 text-xs font-medium text-[#323B4D]"
            >
              <option value="ALL">Tất cả kết quả</option>
              <option value="SUCCEEDED">SUCCEEDED</option>
              <option value="DENIED">DENIED</option>
              <option value="FAILED">FAILED</option>
            </select>

            <select
              aria-label="Số bản ghi"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="rounded-xl border border-[#0D1321]/12 bg-white px-3 py-2 text-xs font-medium text-[#323B4D]"
            >
              <option value="50">50 dòng</option>
              <option value="100">100 dòng</option>
              <option value="200">200 dòng</option>
            </select>
          </div>
        </form>

        {loading && !data ? (
          <div className="py-10 text-center text-sm text-[#64748B]">
            Đang tải nhật ký kiểm toán...
          </div>
        ) : !data || data.events.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#64748B]">
            Chưa có sự kiện nào khớp bộ lọc.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#0D1321]/8 font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                  <th className="py-2.5 pr-3">Thời gian</th>
                  <th className="px-3 py-2.5">Hành động</th>
                  <th className="px-3 py-2.5">Tác nhân</th>
                  <th className="px-3 py-2.5">Đối tượng</th>
                  <th className="px-3 py-2.5">Kết quả</th>
                  <th className="py-2.5 pl-3">Chi tiết &amp; Request ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0D1321]/6">
                {data.events.map((event) => {
                  const metadataKeys = Object.keys(event.metadata);
                  return (
                    <tr key={event.eventId} className="align-top hover:bg-[#F8FAFC]">
                      <td className="whitespace-nowrap py-3 pr-3 font-medium text-[#52607A]">
                        {formatDateTime(event.occurredAt)}
                      </td>
                      <td className="px-3 py-3 font-mono font-semibold text-[#0D1321]">
                        {event.action}
                      </td>
                      <td className="px-3 py-3 text-[#323B4D]">
                        <p className="font-medium">
                          {event.actorEmail ?? event.actorKind}
                        </p>
                        {event.actorName ? (
                          <p className="text-[11px] text-[#64748B]">{event.actorName}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-[#323B4D]">
                        {event.targetType}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={
                            event.outcome === "SUCCEEDED"
                              ? "success"
                              : event.outcome === "DENIED"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {event.outcome}
                        </Badge>
                      </td>
                      <td className="py-3 pl-3 text-[#52607A]">
                        <p className="font-mono text-[11px] text-[#64748B]">
                          req: {event.requestId.slice(0, 8)}…
                        </p>
                        {metadataKeys.length > 0 ? (
                          <p className="mt-1 max-w-xs break-all font-mono text-[11px] text-[#323B4D]">
                            {JSON.stringify(event.metadata)}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
