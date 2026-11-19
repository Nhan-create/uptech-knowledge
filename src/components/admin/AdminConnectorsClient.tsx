"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Database,
  PlugZap,
  RefreshCw,
  Server,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminConnectorRecord,
  AdminSyncJobRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";

interface ConnectorsApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly connectors: readonly AdminConnectorRecord[];
  readonly syncJobs: readonly AdminSyncJobRecord[];
  readonly directoryInfraReady: boolean;
  readonly error?: { readonly message?: string };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Chưa có";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function AdminConnectorsClient() {
  const [data, setData] = useState<ConnectorsApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/v1/admin/connectors", { cache: "no-store" });
      const payload = (await response.json()) as ConnectorsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể tải trạng thái kết nối.");
        return;
      }
      setData(payload);
    } catch {
      setErrorMsg("Mất kết nối tới máy chủ quản trị.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnectors();
  }, [fetchConnectors]);

  const directoryConnector = data?.connectors.find((c) => c.purpose === "DIRECTORY") ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
            Tích hợp &amp; đường ống đồng bộ
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
            Kết nối dữ liệu
          </h2>
          <p className="mt-1 text-sm text-[#52607A]">
            Theo dõi kết nối Google Workspace Directory, kho tri thức đã lập chỉ mục và lịch sử tác vụ đồng bộ thực tế.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchConnectors()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#0D1321]/12 bg-white px-3.5 text-sm font-semibold text-[#323B4D] hover:bg-[#F8FAFC] disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`} />
          <span>Làm mới</span>
        </button>
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Google Workspace Directory Connector */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#EEF1FF] text-[#1B44FF]">
                <PlugZap aria-hidden="true" className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0D1321]">
                  Google Workspace Directory
                </h3>
                <p className="text-xs text-[#64748B]">
                  Đồng bộ nhân sự, nhóm, đơn vị tổ chức (OU) và quyền truy cập
                </p>
              </div>
            </div>
            <Badge
              variant={
                directoryConnector?.status === "ACTIVE"
                  ? "success"
                  : directoryConnector?.status === "DEGRADED"
                    ? "warning"
                    : "neutral"
              }
            >
              {directoryConnector ? directoryConnector.status : "Chưa kết nối"}
            </Badge>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#F8FAFC] p-3.5 text-xs">
            <div>
              <dt className="text-[#64748B]">Customer ID</dt>
              <dd className="mt-0.5 font-mono font-semibold text-[#0D1321]">
                {directoryConnector?.providerCustomerId ??
                  data?.overview.googleCustomerId ??
                  "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Trạng thái đồng bộ gần nhất</dt>
              <dd className="mt-0.5 font-semibold text-[#0D1321]">
                {directoryConnector?.latestGenerationStatus ?? "Chưa chạy"}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Hoàn tất gần nhất</dt>
              <dd className="mt-0.5 font-medium text-[#323B4D]">
                {formatDateTime(directoryConnector?.latestGenerationCompletedAt ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Hiệu lực dữ liệu đến</dt>
              <dd className="mt-0.5 font-medium text-[#323B4D]">
                {formatDateTime(directoryConnector?.latestGenerationFreshUntil ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Hồ sơ đã đồng bộ</dt>
              <dd className="mt-0.5 font-semibold text-[#0D1321]">
                {directoryConnector
                  ? `${directoryConnector.syncedUserCount} người · ${directoryConnector.syncedGroupCount} nhóm`
                  : "0"}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Hạ tầng lưu bí mật (WIF/SM)</dt>
              <dd className="mt-0.5 flex items-center gap-1 font-semibold">
                {data?.directoryInfraReady ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 aria-hidden="true" className="size-3.5" />
                    Sẵn sàng
                  </span>
                ) : (
                  <span className="text-amber-700">Chưa cấu hình GCP Secret Manager</span>
                )}
              </dd>
            </div>
          </dl>

          {directoryConnector && directoryConnector.authorizedScopes.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-[#52607A]">
                OAuth Scopes đã cấp ({directoryConnector.authorizedScopes.length})
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {directoryConnector.authorizedScopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700"
                  >
                    {scope.replace("https://www.googleapis.com/auth/", "")}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        {/* UPTECH Knowledge Engine Storage & Index */}
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <Database aria-hidden="true" className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0D1321]">
                  Kho tri thức &amp; Chỉ mục nội bộ
                </h3>
                <p className="text-xs text-[#64748B]">
                  Lưu trữ PostgreSQL RLS, tách đoạn toàn văn &amp; truy xuất trích dẫn
                </p>
              </div>
            </div>
            <Badge variant="success">Đang hoạt động</Badge>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#F8FAFC] p-3.5 text-xs">
            <div>
              <dt className="text-[#64748B]">Không gian tri thức</dt>
              <dd className="mt-0.5 text-base font-bold text-[#0D1321]">
                {data ? data.overview.spaceCount : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Tài liệu sẵn sàng / tổng</dt>
              <dd className="mt-0.5 text-base font-bold text-[#0D1321]">
                {data
                  ? `${data.overview.readyDocumentCount} / ${data.overview.documentCount}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Đoạn đã lập chỉ mục</dt>
              <dd className="mt-0.5 text-base font-bold text-[#0D1321]">
                {data ? data.overview.chunkCount.toLocaleString("vi-VN") : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[#64748B]">Dung lượng thực tế</dt>
              <dd className="mt-0.5 text-base font-bold text-[#0D1321]">
                {data ? formatBytes(data.overview.storageBytes) : "—"}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-[#64748B]">
              {data ? `${data.overview.knowledgeCardCount} thẻ tri thức đang lưu` : ""}
            </span>
            <Link
              href="/documents"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#1B44FF] hover:underline"
            >
              <span>Mở Thư viện tài liệu</span>
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* Sync Jobs Table */}
      <Card className="p-5">
        <div className="flex items-center gap-2 border-b border-[#0D1321]/8 pb-3">
          <Server aria-hidden="true" className="size-4 text-[#1B44FF]" />
          <h3 className="text-base font-bold text-[#0D1321]">
            Lịch sử tác vụ đồng bộ ({data?.syncJobs.length ?? 0})
          </h3>
        </div>

        {loading && !data ? (
          <div className="py-8 text-center text-sm text-[#64748B]">
            Đang tải lịch sử tác vụ đồng bộ...
          </div>
        ) : !data || data.syncJobs.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#64748B]">
            Chưa có tác vụ đồng bộ nào được ghi nhận cho tổ chức này.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#0D1321]/8 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                  <th className="py-2.5 pr-3">Loại tác vụ</th>
                  <th className="px-3 py-2.5">Trạng thái</th>
                  <th className="px-3 py-2.5">Số lần thử</th>
                  <th className="px-3 py-2.5">Mã lỗi</th>
                  <th className="px-3 py-2.5">Tạo lúc</th>
                  <th className="py-2.5 pl-3">Hoàn tất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0D1321]/6">
                {data.syncJobs.map((job) => (
                  <tr key={job.jobId} className="hover:bg-[#F8FAFC]">
                    <td className="py-3 pr-3 font-mono text-xs font-semibold text-[#0D1321]">
                      {job.jobKind}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={
                          job.status === "SUCCEEDED"
                            ? "success"
                            : job.status === "FAILED" || job.status === "DEAD_LETTER"
                              ? "warning"
                              : "info"
                        }
                      >
                        {job.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-[#323B4D]">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-rose-700">
                      {job.lastErrorCode ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#52607A]">
                      {formatDateTime(job.createdAt)}
                    </td>
                    <td className="py-3 pl-3 text-xs text-[#52607A]">
                      {formatDateTime(job.completedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
