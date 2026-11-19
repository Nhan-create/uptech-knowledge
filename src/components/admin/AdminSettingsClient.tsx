"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  LockKeyhole,
  RefreshCw,
  Save,
  Settings,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminSettingsRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";

interface SettingsApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly settings: AdminSettingsRecord;
  readonly error?: { readonly message?: string };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
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

export function AdminSettingsClient() {
  const [data, setData] = useState<SettingsApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [organizationName, setOrganizationName] = useState("");
  const [defaultLocale, setDefaultLocale] = useState<"vi" | "en">("vi");
  const [retentionDays, setRetentionDays] = useState(365);
  const [maxUploadMb, setMaxUploadMb] = useState(25);
  const [allowMemberUploads, setAllowMemberUploads] = useState(true);
  const [requireVerifiedCardsInChat, setRequireVerifiedCardsInChat] = useState(false);
  const [auditExportEnabled, setAuditExportEnabled] = useState(true);
  const [provisioningPolicy, setProvisioningPolicy] = useState<
    "INVITE_ONLY" | "GOOGLE_GROUP_CONTROLLED"
  >("INVITE_ONLY");

  const syncForm = useCallback((payload: SettingsApiPayload) => {
    setOrganizationName(payload.settings.organizationName);
    setDefaultLocale(payload.settings.defaultLocale);
    setRetentionDays(payload.settings.retentionDays);
    setMaxUploadMb(payload.settings.maxUploadMb);
    setAllowMemberUploads(payload.settings.allowMemberUploads);
    setRequireVerifiedCardsInChat(payload.settings.requireVerifiedCardsInChat);
    setAuditExportEnabled(payload.settings.auditExportEnabled);
    setProvisioningPolicy(
      payload.overview.provisioningPolicy === "GOOGLE_GROUP_CONTROLLED"
        ? "GOOGLE_GROUP_CONTROLLED"
        : "INVITE_ONLY",
    );
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/v1/admin/settings", { cache: "no-store" });
      const payload = (await response.json()) as SettingsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể tải thiết lập tổ chức.");
        return;
      }
      setData(payload);
      syncForm(payload);
    } catch {
      setErrorMsg("Mất kết nối tới máy chủ quản trị.");
    } finally {
      setLoading(false);
    }
  }, [syncForm]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const isOwner = data?.overview.callerRole === "OWNER";
      const response = await fetch("/api/v1/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          defaultLocale,
          retentionDays,
          maxUploadMb,
          allowMemberUploads,
          requireVerifiedCardsInChat,
          auditExportEnabled,
          ...(isOwner ? { provisioningPolicy } : {}),
        }),
      });
      const payload = (await response.json()) as SettingsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể lưu thiết lập tổ chức.");
        return;
      }
      setData(payload);
      syncForm(payload);
      setNoticeMsg("Đã lưu thiết lập tổ chức và ghi nhận vào nhật ký kiểm toán.");
    } catch {
      setErrorMsg("Lỗi kết nối khi lưu thiết lập.");
    } finally {
      setSaving(false);
    }
  }

  const isOwner = data?.overview.callerRole === "OWNER";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
            Cấu hình &amp; Quản trị hệ thống
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
            Thiết lập tổ chức
          </h2>
          <p className="mt-1 text-sm text-[#52607A]">
            Quản lý định danh tổ chức, tên miền đã xác minh, chính sách lưu trữ tài liệu và cơ chế cấp quyền truy cập.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchSettings()}
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
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
          <span>{noticeMsg}</span>
        </div>
      ) : null}

      {/* Verified Domains & Workspace Identity */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Globe aria-hidden="true" className="size-4 text-[#1B44FF]" />
          <h3 className="text-base font-bold text-[#0D1321]">
            Định danh &amp; Tên miền đã xác minh
          </h3>
        </div>

        <dl className="mt-4 grid gap-3 rounded-xl bg-[#F8FAFC] p-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[#64748B]">Workspace ID</dt>
            <dd className="mt-1 break-all font-mono font-semibold text-[#0D1321]">
              {data?.overview.workspaceId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748B]">Google Customer ID</dt>
            <dd className="mt-1 break-all font-mono font-semibold text-[#0D1321]">
              {data?.overview.googleCustomerId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748B]">Trạng thái tổ chức</dt>
            <dd className="mt-1">
              <Badge variant="success">{data?.overview.workspaceStatus ?? "ACTIVE"}</Badge>
            </dd>
          </div>
        </dl>

        <div className="mt-4 space-y-2">
          {(data?.overview.domains ?? []).map((item) => (
            <div
              key={item.domain}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#0D1321]/10 bg-white px-4 py-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#0D1321]">{item.domain}</span>
                <Badge variant="info">{item.domainKind}</Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#52607A]">
                <Badge variant="success">{item.status}</Badge>
                <span>Xác minh: {formatDateTime(item.verifiedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Organization Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Settings aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <h3 className="text-base font-bold text-[#0D1321]">
              Thông số vận hành không gian tri thức
            </h3>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-[#323B4D]">
                Tên hiển thị tổ chức *
              </span>
              <input
                type="text"
                required
                maxLength={120}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#323B4D]">
                Ngôn ngữ mặc định
              </span>
              <select
                value={defaultLocale}
                onChange={(e) => setDefaultLocale(e.target.value === "en" ? "en" : "vi")}
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3 py-2.5 text-sm text-[#0D1321]"
              >
                <option value="vi">Tiếng Việt (vi)</option>
                <option value="en">English (en)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#323B4D]">
                Thời gian lưu trữ dữ liệu &amp; nhật ký (ngày: 30–3650)
              </span>
              <input
                type="number"
                min={30}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321]"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#323B4D]">
                Giới hạn kích thước tệp tải lên (MB: 1–100)
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={maxUploadMb}
                onChange={(e) => setMaxUploadMb(Number(e.target.value))}
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321]"
              />
            </label>
          </div>

          <div className="mt-5 space-y-3 border-t border-[#0D1321]/8 pt-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={allowMemberUploads}
                onChange={(e) => setAllowMemberUploads(e.target.checked)}
                className="mt-1 size-4 rounded border-slate-300 text-[#1B44FF]"
              />
              <div>
                <span className="text-sm font-semibold text-[#0D1321]">
                  Cho phép thành viên tải lên tài liệu vào Thư viện
                </span>
                <p className="text-xs text-[#64748B]">
                  Nếu tắt, chỉ OWNER và ADMIN mới có quyền tải thêm tài liệu mới.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={requireVerifiedCardsInChat}
                onChange={(e) => setRequireVerifiedCardsInChat(e.target.checked)}
                className="mt-1 size-4 rounded border-slate-300 text-[#1B44FF]"
              />
              <div>
                <span className="text-sm font-semibold text-[#0D1321]">
                  Ưu tiên Thẻ tri thức đã xác minh khi Trợ lý AI phản hồi
                </span>
                <p className="text-xs text-[#64748B]">
                  Giúp các quy định và quyết định chuẩn hóa luôn được ưu tiên trích dẫn trước bản nháp.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={auditExportEnabled}
                onChange={(e) => setAuditExportEnabled(e.target.checked)}
                className="mt-1 size-4 rounded border-slate-300 text-[#1B44FF]"
              />
              <div>
                <span className="text-sm font-semibold text-[#0D1321]">
                  Cho phép xuất nhật ký kiểm toán định dạng CSV
                </span>
                <p className="text-xs text-[#64748B]">
                  Kiểm soát khả năng tải xuống tệp CSV ở mục Nhật ký.
                </p>
              </div>
            </label>
          </div>
        </Card>

        {/* Provisioning Policy (OWNER-only control) */}
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <h3 className="text-base font-bold text-[#0D1321]">
              Chính sách cấp quyền thành viên
            </h3>
          </div>
          <p className="mt-1 text-xs text-[#52607A]">
            {isOwner
              ? "Chỉ Chủ sở hữu (OWNER) mới có thể thay đổi chính sách cấp quyền. Chế độ GOOGLE_GROUP_CONTROLLED yêu cầu đã đồng bộ Google Directory thành công."
              : "Tài khoản ADMIN chỉ xem được chính sách này; liên hệ OWNER nếu cần thay đổi."}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${
                provisioningPolicy === "INVITE_ONLY"
                  ? "border-[#1B44FF] bg-[#EEF1FF]/50"
                  : "border-[#0D1321]/10 bg-white"
              }`}
            >
              <input
                type="radio"
                name="provisioningPolicy"
                disabled={!isOwner}
                checked={provisioningPolicy === "INVITE_ONLY"}
                onChange={() => setProvisioningPolicy("INVITE_ONLY")}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-semibold text-[#0D1321]">
                  INVITE_ONLY (Mời &amp; Phê duyệt thủ công)
                </span>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  Quản trị viên trực tiếp mời thành viên và phân vai trò ngay trong mục Người dùng.
                </p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${
                provisioningPolicy === "GOOGLE_GROUP_CONTROLLED"
                  ? "border-[#1B44FF] bg-[#EEF1FF]/50"
                  : "border-[#0D1321]/10 bg-white"
              }`}
            >
              <input
                type="radio"
                name="provisioningPolicy"
                disabled={!isOwner}
                checked={provisioningPolicy === "GOOGLE_GROUP_CONTROLLED"}
                onChange={() => setProvisioningPolicy("GOOGLE_GROUP_CONTROLLED")}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-semibold text-[#0D1321]">
                  GOOGLE_GROUP_CONTROLLED (Tự động theo Google Directory)
                </span>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  Cấp quyền và thu hồi tự động theo Google Groups / OU / phòng ban đã đồng bộ.
                </p>
              </div>
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-xs text-[#64748B]">
              Cập nhật lần cuối: {formatDateTime(data?.settings.updatedAt ?? null)}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1B44FF] px-5 text-sm font-semibold text-white hover:bg-[#1635C7] disabled:opacity-60"
            >
              <Save aria-hidden="true" className="size-4" />
              <span>{saving ? "Đang lưu..." : "Lưu thiết lập"}</span>
            </button>
          </div>
        </Card>
      </form>
    </div>
  );
}
