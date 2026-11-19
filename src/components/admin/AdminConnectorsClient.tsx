"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminConnectorRecord,
  AdminSyncJobRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";
import type {
  IngestionApiKeyRecord,
  KnowledgeConnectorRecord,
} from "@/server/knowledge/repository";

interface ConnectorsApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly connectors: readonly AdminConnectorRecord[];
  readonly syncJobs: readonly AdminSyncJobRecord[];
  readonly directoryInfraReady: boolean;
  readonly knowledgeConnectors?: readonly KnowledgeConnectorRecord[];
  readonly ingestionApiKeys?: readonly IngestionApiKeyRecord[];
  readonly spaces?: ReadonlyArray<{ id: string; name: string }>;
  readonly createdSecretKey?: string;
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
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [createdSecretKey, setCreatedSecretKey] = useState<string | null>(null);

  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlSpaceId, setCrawlSpaceId] = useState("spc_8f2a01");
  const [crawling, setCrawling] = useState(false);

  const [apiKeyLabel, setApiKeyLabel] = useState("");
  const [apiKeySpaceId, setApiKeySpaceId] = useState("spc_8f2a01");
  const [busyKeyAction, setBusyKeyAction] = useState<string | null>(null);

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

  async function handleCrawlUrl(e: FormEvent, existing?: KnowledgeConnectorRecord) {
    e.preventDefault();
    const targetUrl = existing ? existing.sourceUrl : crawlUrl.trim();
    const targetSpace = existing ? existing.spaceId : crawlSpaceId;
    if (!targetUrl) return;

    setCrawling(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch("/api/v1/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "crawl_url",
          url: targetUrl,
          spaceId: targetSpace,
          connectorId: existing?.id,
          documentId: existing?.documentId,
        }),
      });
      const payload = (await response.json()) as ConnectorsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(
          payload.error?.message ?? "Không thể thu thập và lập chỉ mục URL nguồn.",
        );
        return;
      }
      setData(payload);
      if (!existing) setCrawlUrl("");
      setNoticeMsg(
        existing
          ? `Đã đồng bộ lại nguồn "${existing.title}" vào chỉ mục RAG.`
          : "Đã thu thập, làm sạch DLP và lập chỉ mục trang tài liệu Web vào kho tri thức.",
      );
    } catch {
      setErrorMsg("Lỗi kết nối khi thu thập dữ liệu từ URL.");
    } finally {
      setCrawling(false);
    }
  }

  async function handleCreateApiKey(e: FormEvent) {
    e.preventDefault();
    setBusyKeyAction("create");
    setErrorMsg(null);
    setNoticeMsg(null);
    setCreatedSecretKey(null);
    try {
      const response = await fetch("/api/v1/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_api_key",
          label: apiKeyLabel.trim() || "CI/CD & Docs Ingestion Key",
          spaceId: apiKeySpaceId,
        }),
      });
      const payload = (await response.json()) as ConnectorsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể khởi tạo khóa API.");
        return;
      }
      setData(payload);
      setApiKeyLabel("");
      if (payload.createdSecretKey) {
        setCreatedSecretKey(payload.createdSecretKey);
      }
    } finally {
      setBusyKeyAction(null);
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    setBusyKeyAction(keyId);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/v1/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revoke_api_key",
          keyId,
        }),
      });
      const payload = (await response.json()) as ConnectorsApiPayload;
      if (response.ok && payload.ok) {
        setData(payload);
      }
    } finally {
      setBusyKeyAction(null);
    }
  }

  const directoryConnector = data?.connectors.find((c) => c.purpose === "DIRECTORY") ?? null;
  const spaces = data?.spaces && data.spaces.length > 0
    ? data.spaces
    : [
        { id: "spc_8f2a01", name: "Nhân sự" },
        { id: "spc_c14d72", name: "Vận hành" },
        { id: "spc_6be903", name: "Dự án Atlas" },
      ];

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

      {noticeMsg ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{noticeMsg}</span>
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

      {/* Web / Wiki / Docs URL Knowledge Crawler */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#0D1321]/8 pb-3">
          <div className="flex items-center gap-2.5">
            <Globe aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <div>
              <h3 className="text-base font-bold text-[#0D1321]">
                Kết nối Nguồn Tri thức Web / Wiki / Docs URL
              </h3>
              <p className="text-xs text-[#64748B]">
                Tự động thu thập trang tài liệu, lọc sạch HTML/Markdown, quét bảo mật DLP và lập chỉ mục vector vào Không gian tri thức.
              </p>
            </div>
          </div>
          <Badge variant="info">
            {data?.knowledgeConnectors?.length ?? 0} nguồn đã kết nối
          </Badge>
        </div>

        <form
          onSubmit={(e) => void handleCrawlUrl(e)}
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto]"
        >
          <input
            type="url"
            required
            value={crawlUrl}
            onChange={(e) => setCrawlUrl(e.currentTarget.value)}
            placeholder="https://docs.example.com/handbook hoặc trang chính sách / tài liệu kỹ thuật..."
            className="h-10 rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3.5 text-xs text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
          />
          <select
            aria-label="Không gian đích"
            value={crawlSpaceId}
            onChange={(e) => setCrawlSpaceId(e.currentTarget.value)}
            className="h-10 rounded-xl border border-[#0D1321]/14 bg-white px-3 text-xs font-medium text-[#0D1321]"
          >
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={crawling || !crawlUrl.trim()}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#1B44FF] px-4 text-xs font-semibold text-white hover:bg-[#1635C7] disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-3.5 ${crawling ? "animate-spin" : ""}`}
            />
            <span>{crawling ? "Đang thu thập…" : "Thu thập & Lập chỉ mục"}</span>
          </button>
        </form>

        {data?.knowledgeConnectors && data.knowledgeConnectors.length > 0 ? (
          <div className="mt-4 space-y-2">
            {data.knowledgeConnectors.map((conn) => (
              <div
                key={conn.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0D1321]/8 bg-[#F8FAFC] px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-[#0D1321]">{conn.title}</span>
                    <Badge variant="success" size="sm">
                      {conn.chunkCount} đoạn chỉ mục
                    </Badge>
                    <span className="text-[#64748B]">
                      Đồng bộ: {formatDateTime(conn.lastSyncedAtIso)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[#52607A]">
                    {conn.sourceUrl}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {conn.documentId ? (
                    <Link
                      href={`/documents/${encodeURIComponent(conn.documentId)}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#0D1321]/12 bg-white px-2.5 font-semibold text-[#1635C7] hover:bg-[#EEF3FF]"
                    >
                      <span>Mở tài liệu</span>
                      <ArrowUpRight aria-hidden="true" className="size-3" />
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    disabled={crawling}
                    onClick={(e) => void handleCrawlUrl(e, conn)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#0D1321]/12 bg-white px-2.5 font-semibold text-[#0D1321] hover:bg-[#F3F4F8] disabled:opacity-50"
                  >
                    <RefreshCw aria-hidden="true" className="size-3" />
                    <span>Đồng bộ lại (v2.0+)</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* Enterprise Ingestion API Keys */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#0D1321]/8 pb-3">
          <div className="flex items-center gap-2.5">
            <KeyRound aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <div>
              <h3 className="text-base font-bold text-[#0D1321]">
                Khóa API Đồng bộ Tri thức Tự động (Enterprise Ingestion Keys)
              </h3>
              <p className="text-xs text-[#64748B]">
                Cấp khóa SHA-256 (`upt_live_...`) để đẩy tài liệu tự động từ CI/CD, GitHub Actions, Confluence hoặc Notion vào kho tri thức.
              </p>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => void handleCreateApiKey(e)}
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto]"
        >
          <input
            type="text"
            value={apiKeyLabel}
            onChange={(e) => setApiKeyLabel(e.currentTarget.value)}
            placeholder="Tên khóa tích hợp (VD: GitHub Docs CI/CD, Notion Sync Pipeline)"
            className="h-10 rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3.5 text-xs text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
          />
          <select
            aria-label="Không gian mặc định cho khóa API"
            value={apiKeySpaceId}
            onChange={(e) => setApiKeySpaceId(e.currentTarget.value)}
            className="h-10 rounded-xl border border-[#0D1321]/14 bg-white px-3 text-xs font-medium text-[#0D1321]"
          >
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busyKeyAction === "create"}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#0B1220] px-4 text-xs font-semibold text-white hover:bg-[#172136] disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            <span>Tạo khóa API mới</span>
          </button>
        </form>

        {createdSecretKey ? (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs">
            <p className="font-bold text-amber-950">
              Khóa bí mật vừa tạo (chỉ hiển thị một lần duy nhất — hãy sao chép ngay):
            </p>
            <code className="mt-1.5 block select-all rounded-lg bg-white px-3 py-2 font-mono text-xs font-semibold text-[#0D1321]">
              {createdSecretKey}
            </code>
          </div>
        ) : null}

        {data?.ingestionApiKeys && data.ingestionApiKeys.length > 0 ? (
          <div className="mt-4 space-y-2">
            {data.ingestionApiKeys.map((keyItem) => (
              <div
                key={keyItem.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0D1321]/8 bg-[#F8FAFC] px-4 py-2.5 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#0D1321]">{keyItem.label}</span>
                    <code className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-[#323B4D]">
                      {keyItem.keyPrefix}
                    </code>
                    {keyItem.revokedAtIso ? (
                      <Badge variant="warning" size="sm">
                        Đã thu hồi
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">
                        Đang hiệu lực
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#64748B]">
                    Tạo bởi {keyItem.createdByLabel} · {formatDateTime(keyItem.createdAtIso)}
                  </p>
                </div>
                {!keyItem.revokedAtIso ? (
                  <button
                    type="button"
                    disabled={busyKeyAction === keyItem.id}
                    onClick={() => void handleRevokeApiKey(keyItem.id)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    <span>Thu hồi</span>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

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
