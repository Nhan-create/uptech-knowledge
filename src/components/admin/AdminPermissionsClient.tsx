"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminDirectoryGroupRecord,
  AdminDirectoryOrgUnitRecord,
  AdminPermissionMappingRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";

interface PermissionsApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly mappings: readonly AdminPermissionMappingRecord[];
  readonly groups: readonly AdminDirectoryGroupRecord[];
  readonly orgUnits: readonly AdminDirectoryOrgUnitRecord[];
  readonly error?: { readonly message?: string };
}

const SOURCE_KIND_LABELS: Record<AdminPermissionMappingRecord["sourceKind"], string> = {
  ADMIN_GROUP: "Google Group → Quản trị (ADMIN)",
  GROUP: "Google Group → Phòng ban",
  DEPARTMENT: "Tên phòng ban Google → Phòng ban",
  ORG_UNIT: "Google OrgUnit ID → Phòng ban",
};

const DEPARTMENTS = [
  { key: "SALES", label: "Kinh doanh (SALES)" },
  { key: "HR", label: "Nhân sự (HR)" },
  { key: "IT", label: "Công nghệ (IT)" },
  { key: "FINANCE", label: "Tài chính (FINANCE)" },
] as const;

const RBAC_MATRIX = [
  {
    role: "OWNER",
    label: "Chủ sở hữu",
    variant: "info" as const,
    scope:
      "Toàn quyền tổ chức: quản lý OWNER/ADMIN/MEMBER, đổi chính sách cấp quyền, thiết lập tổ chức, thanh toán, kết nối dữ liệu và nhật ký kiểm toán.",
  },
  {
    role: "ADMIN",
    label: "Quản trị viên",
    variant: "success" as const,
    scope:
      "Quản lý thành viên (trừ OWNER), mời nhân sự, cấu hình ánh xạ quyền phòng ban, xem kết nối dữ liệu, hồ sơ thanh toán và xuất nhật ký kiểm toán.",
  },
  {
    role: "MEMBER",
    label: "Thành viên",
    variant: "neutral" as const,
    scope:
      "Truy cập không gian tri thức, hỏi đáp Trợ lý AI, tìm kiếm và tài liệu theo đúng phạm vi tổ chức / phòng ban được phân quyền; không vào được khu vực /admin.",
  },
];

export function AdminPermissionsClient() {
  const [data, setData] = useState<PermissionsApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [sourceKind, setSourceKind] =
    useState<AdminPermissionMappingRecord["sourceKind"]>("ADMIN_GROUP");
  const [sourceValue, setSourceValue] = useState("");
  const [targetDept, setTargetDept] = useState<string>("IT");

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/v1/admin/permissions", { cache: "no-store" });
      const payload = (await response.json()) as PermissionsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể tải quy tắc phân quyền.");
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
    void fetchPermissions();
  }, [fetchPermissions]);

  async function handleSaveRule(event: React.FormEvent) {
    event.preventDefault();
    setBusyKey("create");
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch("/api/v1/admin/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind,
          sourceValue: sourceValue.trim(),
          targetDepartmentKey: sourceKind === "ADMIN_GROUP" ? null : targetDept,
          status: "ACTIVE",
        }),
      });
      const payload = (await response.json()) as PermissionsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể lưu quy tắc phân quyền.");
        return;
      }
      setData(payload);
      setSourceValue("");
      setNoticeMsg("Đã lưu quy tắc ánh xạ quyền và ghi nhật ký kiểm toán.");
    } catch {
      setErrorMsg("Lỗi kết nối khi lưu quy tắc phân quyền.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleMapping(mapping: AdminPermissionMappingRecord) {
    setBusyKey(`toggle:${mapping.mappingId}`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const nextStatus = mapping.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
      const response = await fetch("/api/v1/admin/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind: mapping.sourceKind,
          sourceValue: mapping.sourceValue,
          targetDepartmentKey: mapping.targetDepartmentKey,
          status: nextStatus,
        }),
      });
      const payload = (await response.json()) as PermissionsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể cập nhật trạng thái quy tắc.");
        return;
      }
      setData(payload);
      setNoticeMsg(
        nextStatus === "ACTIVE" ? "Đã kích hoạt quy tắc." : "Đã tạm tắt quy tắc.",
      );
    } catch {
      setErrorMsg("Lỗi kết nối khi cập nhật quy tắc.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteMapping(mappingId: string) {
    setBusyKey(`delete:${mappingId}`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch(
        `/api/v1/admin/permissions?mappingId=${encodeURIComponent(mappingId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as PermissionsApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể xóa quy tắc.");
        return;
      }
      setData(payload);
      setNoticeMsg("Đã xóa quy tắc phân quyền.");
    } catch {
      setErrorMsg("Lỗi kết nối khi xóa quy tắc.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
            Ủy quyền &amp; kiểm soát truy cập
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
            Mô hình quyền &amp; Ánh xạ phòng ban
          </h2>
          <p className="mt-1 text-sm text-[#52607A]">
            Toàn bộ quy tắc RBAC và ánh xạ Google Directory được thực thi nghiêm ngặt tại PostgreSQL RLS và máy chủ.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchPermissions()}
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

      {/* Role Matrix */}
      <div className="grid gap-3 md:grid-cols-3">
        {RBAC_MATRIX.map((item) => (
          <Card key={item.role} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#0D1321]">{item.label}</h3>
              <Badge variant={item.variant}>{item.role}</Badge>
            </div>
            <p className="mt-2.5 text-xs leading-5 text-[#52607A]">{item.scope}</p>
          </Card>
        ))}
      </div>

      {/* Add Mapping Rule Form */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-[#0D1321]">
              Thêm hoặc cập nhật quy tắc ánh xạ truy cập
            </h3>
            <p className="mt-0.5 text-xs text-[#52607A]">
              Chính sách tổ chức hiện tại:{" "}
              <strong>{data?.overview.provisioningPolicy ?? "Đang tải..."}</strong>. Các quy tắc này áp dụng tự động khi đồng bộ Google Directory.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveRule} className="mt-4 grid gap-4 md:grid-cols-12">
          <label className="block md:col-span-4">
            <span className="text-xs font-semibold text-[#323B4D]">Loại tín hiệu nguồn</span>
            <select
              value={sourceKind}
              onChange={(e) => {
                setSourceKind(e.target.value as AdminPermissionMappingRecord["sourceKind"]);
                setSourceValue("");
              }}
              className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3 py-2.5 text-sm text-[#0D1321]"
            >
              <option value="ADMIN_GROUP">{SOURCE_KIND_LABELS.ADMIN_GROUP}</option>
              <option value="GROUP">{SOURCE_KIND_LABELS.GROUP}</option>
              <option value="DEPARTMENT">{SOURCE_KIND_LABELS.DEPARTMENT}</option>
              <option value="ORG_UNIT">{SOURCE_KIND_LABELS.ORG_UNIT}</option>
            </select>
          </label>

          <label className="block md:col-span-4">
            <span className="text-xs font-semibold text-[#323B4D]">
              {sourceKind === "ADMIN_GROUP" || sourceKind === "GROUP"
                ? "Google Group ID"
                : sourceKind === "ORG_UNIT"
                  ? "Google OrgUnit ID (id:...)"
                  : "Tên phòng ban (chữ thường)"}
            </span>
            <input
              type="text"
              required
              list="admin-directory-source-suggestions"
              value={sourceValue}
              onChange={(e) => setSourceValue(e.target.value)}
              placeholder={
                sourceKind === "DEPARTMENT"
                  ? "ví dụ: engineering, sales, hr"
                  : sourceKind === "ORG_UNIT"
                    ? "ví dụ: id:03ph8a2z2..."
                    : "ví dụ: 02grqrue4..."
              }
              className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
            />
            <datalist id="admin-directory-source-suggestions">
              {(sourceKind === "ADMIN_GROUP" || sourceKind === "GROUP") &&
                (data?.groups ?? []).map((group) => (
                  <option key={group.googleGroupId} value={group.googleGroupId}>
                    {group.groupName}
                  </option>
                ))}
              {sourceKind === "ORG_UNIT" &&
                (data?.orgUnits ?? []).map((ou) => (
                  <option key={ou.googleOrgUnitId} value={ou.googleOrgUnitId}>
                    {ou.orgUnitPath}
                  </option>
                ))}
            </datalist>
          </label>

          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-[#323B4D]">Đích phân quyền</span>
            {sourceKind === "ADMIN_GROUP" ? (
              <div className="mt-1.5 flex h-[42px] items-center rounded-xl border border-[#0D1321]/10 bg-slate-50 px-3 text-sm font-semibold text-[#1635C7]">
                ADMIN
              </div>
            ) : (
              <select
                value={targetDept}
                onChange={(e) => setTargetDept(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3 py-2.5 text-sm text-[#0D1321]"
              >
                {DEPARTMENTS.map((dept) => (
                  <option key={dept.key} value={dept.key}>
                    {dept.label}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              disabled={busyKey === "create"}
              className="inline-flex h-[42px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#1B44FF] px-4 text-sm font-semibold text-white hover:bg-[#1635C7] disabled:opacity-60"
            >
              <Plus aria-hidden="true" className="size-4" />
              <span>{busyKey === "create" ? "Đang lưu" : "Lưu quy tắc"}</span>
            </button>
          </div>
        </form>
      </Card>

      {/* Active Mappings Table */}
      <Card className="p-5">
        <div className="flex items-center gap-2 border-b border-[#0D1321]/8 pb-3">
          <ShieldCheck aria-hidden="true" className="size-4 text-[#1B44FF]" />
          <h3 className="text-base font-bold text-[#0D1321]">
            Danh sách quy tắc đang lưu ({data?.mappings.length ?? 0})
          </h3>
        </div>

        {loading && !data ? (
          <div className="py-8 text-center text-sm text-[#64748B]">
            Đang tải quy tắc phân quyền...
          </div>
        ) : !data || data.mappings.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#64748B]">
            Chưa có quy tắc ánh xạ nào. Hãy thêm quy tắc phía trên để gán nhóm quản trị hoặc phòng ban tự động.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#0D1321]/8 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                  <th className="py-2.5 pr-3">Loại nguồn</th>
                  <th className="px-3 py-2.5">Giá trị nguồn</th>
                  <th className="px-3 py-2.5">Vai trò đích</th>
                  <th className="px-3 py-2.5">Phòng ban</th>
                  <th className="px-3 py-2.5">Trạng thái</th>
                  <th className="py-2.5 pl-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0D1321]/6">
                {data.mappings.map((rule) => (
                  <tr key={rule.mappingId} className="hover:bg-[#F8FAFC]">
                    <td className="py-3 pr-3 font-medium text-[#0D1321]">
                      {rule.sourceKind}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-[#323B4D]">
                      {rule.sourceValue}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={rule.targetRole === "ADMIN" ? "info" : "neutral"}>
                        {rule.targetRole}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs font-semibold text-[#323B4D]">
                      {rule.targetDepartmentKey ?? "Toàn tổ chức"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={rule.status === "ACTIVE" ? "success" : "neutral"}>
                        {rule.status === "ACTIVE" ? "Đang áp dụng" : "Tạm tắt"}
                      </Badge>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyKey === `toggle:${rule.mappingId}`}
                          onClick={() => void handleToggleMapping(rule)}
                          className="rounded-lg border border-[#0D1321]/12 bg-white px-2.5 py-1 text-xs font-semibold text-[#323B4D] hover:bg-slate-50"
                        >
                          {rule.status === "ACTIVE" ? "Tắt" : "Bật"}
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `delete:${rule.mappingId}`}
                          onClick={() => void handleDeleteMapping(rule.mappingId)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                          <span>Xóa</span>
                        </button>
                      </div>
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
