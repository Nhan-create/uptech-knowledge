"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Copy,
  Mail,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type {
  AdminAccessRequestRecord,
  AdminDirectoryGroupRecord,
  AdminDirectoryOrgUnitRecord,
  AdminInviteRecord,
  AdminMemberRecord,
  AdminWorkspaceOverview,
} from "@/server/admin/repository";

interface UsersApiPayload {
  readonly ok: boolean;
  readonly overview: AdminWorkspaceOverview;
  readonly members: readonly AdminMemberRecord[];
  readonly invites: readonly AdminInviteRecord[];
  readonly accessRequests: readonly AdminAccessRequestRecord[];
  readonly groups: readonly AdminDirectoryGroupRecord[];
  readonly orgUnits: readonly AdminDirectoryOrgUnitRecord[];
  readonly invite?: {
    readonly email: string;
    readonly provisionedImmediately: boolean;
  };
  readonly emailDelivery?: "sent" | "skipped";
  readonly loginUrl?: string;
  readonly error?: { readonly code?: string; readonly message?: string };
}

const ROLE_LABELS: Record<AdminMemberRecord["role"], string> = {
  OWNER: "Chủ sở hữu",
  ADMIN: "Quản trị viên",
  MEMBER: "Thành viên",
};

const STATUS_LABELS: Record<AdminMemberRecord["status"], string> = {
  ACTIVE: "Đang hoạt động",
  PENDING: "Chờ kích hoạt",
  SUSPENDED: "Tạm khóa",
  DEPROVISIONED: "Đã thu hồi",
};

const REASON_LABELS: Record<string, string> = {
  USER_NOT_PROVISIONED: "Chưa được cấp phòng ban/quyền truy cập",
  ACCESS_MAPPING_CONFLICT: "Xung đột quy tắc ánh xạ phòng ban",
  DIRECTORY_STALE: "Danh bạ Google Directory cần làm mới",
  ORGANIZATION_ALREADY_REGISTERED: "Tổ chức đã đăng ký",
};

function formatDateTime(iso: string): string {
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

function initialsFrom(name: string | null, email: string | null): string {
  const source = name || email || "U";
  const parts = source.trim().split(/\s+/u);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function AdminUsersClient() {
  const [data, setData] = useState<UsersApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [copiedLoginUrl, setCopiedLoginUrl] = useState(false);
  const [lastLoginUrl, setLastLoginUrl] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [inviteDept, setInviteDept] = useState<string>("");
  const [inviteNote, setInviteNote] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/v1/admin/users", { cache: "no-store" });
      const payload = (await response.json()) as UsersApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể tải danh sách người dùng.");
        return;
      }
      setData(payload);
    } catch {
      setErrorMsg("Mất kết nối tới máy chủ quản trị. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const filteredMembers = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.members.filter((m) => {
      if (roleFilter !== "ALL" && m.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (m.email ?? "").toLowerCase().includes(q) ||
        (m.fullName ?? "").toLowerCase().includes(q) ||
        (m.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query, roleFilter, statusFilter]);

  const primaryDomain = data?.overview.domains[0]?.domain ?? "";
  const isOwner = data?.overview.callerRole === "OWNER";

  async function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusyKey("invite");
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          departmentKey: inviteDept || null,
          note: inviteNote.trim() || null,
        }),
      });
      const payload = (await response.json()) as UsersApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể gửi lời mời.");
        return;
      }
      setData(payload);
      setInviteEmail("");
      setInviteNote("");
      setInviteDept("");
      setShowInviteForm(false);
      setLastLoginUrl(payload.loginUrl ?? null);
      if (payload.invite?.provisionedImmediately) {
        setNoticeMsg(
          `Đã cấp quyền truy cập ngay lập tức cho ${payload.invite.email} (tài khoản đã tồn tại trong hệ thống).`,
        );
      } else if (payload.emailDelivery === "sent") {
        setNoticeMsg(`Đã tạo lời mời và gửi email thông báo tới ${payload.invite?.email}.`);
      } else {
        setNoticeMsg(
          `Đã lưu lời mời cho ${payload.invite?.email}. Bạn có thể sao chép đường dẫn đăng nhập để gửi nội bộ.`,
        );
      }
    } catch {
      setErrorMsg("Không thể kết nối máy chủ để tạo lời mời.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUpdateMember(
    membershipId: string,
    patch: { role?: string; status?: string },
  ) {
    setBusyKey(`member:${membershipId}`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId, ...patch }),
      });
      const payload = (await response.json()) as UsersApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể cập nhật thành viên.");
        return;
      }
      setData(payload);
      setNoticeMsg("Đã cập nhật quyền thành viên và ghi nhận nhật ký kiểm toán.");
    } catch {
      setErrorMsg("Lỗi kết nối khi cập nhật thành viên.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    setBusyKey(`invite:${inviteId}`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch(
        `/api/v1/admin/users?inviteId=${encodeURIComponent(inviteId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as UsersApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể thu hồi lời mời.");
        return;
      }
      setData(payload);
      setNoticeMsg("Đã thu hồi lời mời.");
    } catch {
      setErrorMsg("Lỗi kết nối khi thu hồi lời mời.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleResolveRequest(
    requestRowId: string,
    decision: "APPROVE" | "REJECT",
  ) {
    setBusyKey(`req:${requestRowId}`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const response = await fetch("/api/v1/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve_access_request",
          requestRowId,
          decision,
          role: "MEMBER",
        }),
      });
      const payload = (await response.json()) as UsersApiPayload;
      if (!response.ok || !payload.ok) {
        setErrorMsg(payload.error?.message ?? "Không thể xử lý yêu cầu truy cập.");
        return;
      }
      setData(payload);
      setNoticeMsg(
        decision === "APPROVE"
          ? "Đã phê duyệt yêu cầu và cấp quyền thành viên."
          : "Đã từ chối yêu cầu truy cập.",
      );
    } catch {
      setErrorMsg("Lỗi kết nối khi xử lý yêu cầu truy cập.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCopyLoginUrl() {
    if (!lastLoginUrl) return;
    try {
      await navigator.clipboard.writeText(lastLoginUrl);
      setCopiedLoginUrl(true);
      setTimeout(() => setCopiedLoginUrl(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  }

  const pendingInvites = (data?.invites ?? []).filter((inv) => inv.status === "PENDING");
  const pendingRequests = (data?.accessRequests ?? []).filter(
    (req) => req.status === "PENDING",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
            Quản trị danh bạ &amp; thành viên
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
            Người dùng và nhóm
          </h2>
          <p className="mt-1 text-sm text-[#52607A]">
            Quản lý thành viên thực tế, phân vai trò, xử lý yêu cầu truy cập và nhóm Google Workspace của tổ chức.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchUsers()}
            disabled={loading}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#0D1321]/12 bg-white px-3.5 text-sm font-semibold text-[#323B4D] transition-colors hover:bg-[#F8FAFC] disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`} />
            <span>Làm mới</span>
          </button>
          <button
            type="button"
            onClick={() => setShowInviteForm((prev) => !prev)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#1B44FF] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1635C7]"
          >
            <UserPlus aria-hidden="true" className="size-4" />
            <span>Mời người dùng</span>
          </button>
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

      {noticeMsg ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
            {noticeMsg}
          </span>
          {lastLoginUrl ? (
            <button
              type="button"
              onClick={() => void handleCopyLoginUrl()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Copy aria-hidden="true" className="size-3.5" />
              <span>{copiedLoginUrl ? "Đã sao chép" : "Sao chép link /login"}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* KPI Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
            Thành viên hoạt động
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? data.overview.activeMemberCount : "—"}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            {data ? `${data.overview.activeSessionCount} phiên đang đăng nhập` : "Đang tải..."}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
            Quản trị viên (Owner/Admin)
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? data.overview.adminMemberCount : "—"}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            Kiểm soát toàn bộ không gian tri thức
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
            Lời mời đang chờ
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? pendingInvites.length : "—"}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            Hiệu lực 7 ngày theo tên miền xác minh
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
            Yêu cầu truy cập chờ duyệt
          </p>
          <p className="mt-2 text-2xl font-bold text-[#0D1321]">
            {data ? pendingRequests.length : "—"}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            {data ? `${data.groups.length} nhóm Google Directory` : "Đang tải..."}
          </p>
        </Card>
      </div>

      {/* Invite Member Form */}
      {showInviteForm ? (
        <Card className="border-[#1B44FF]/30 bg-[#F8FAFF] p-5">
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0D1321]">
                Mời thành viên mới vào tổ chức
              </h3>
              <span className="text-xs font-medium text-[#52607A]">
                Tên miền hợp lệ: <strong>{primaryDomain || "Chưa xác minh"}</strong>
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-[#323B4D]">
                  Email công ty *
                </span>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={primaryDomain ? `nhanvien@${primaryDomain}` : "name@company.com"}
                  className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-[#323B4D]">Vai trò</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value === "ADMIN" ? "ADMIN" : "MEMBER")}
                  className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
                >
                  <option value="MEMBER">Thành viên (MEMBER)</option>
                  <option value="ADMIN">Quản trị viên (ADMIN)</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-[#323B4D]">
                  Phòng ban (tùy chọn)
                </span>
                <select
                  value={inviteDept}
                  onChange={(e) => setInviteDept(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
                >
                  <option value="">Chưa gắn phòng ban</option>
                  <option value="SALES">Kinh doanh (SALES)</option>
                  <option value="HR">Nhân sự (HR)</option>
                  <option value="IT">Công nghệ (IT)</option>
                  <option value="FINANCE">Tài chính (FINANCE)</option>
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-[#323B4D]">
                  Ghi chú nội bộ (tùy chọn)
                </span>
                <input
                  type="text"
                  maxLength={240}
                  value={inviteNote}
                  onChange={(e) => setInviteNote(e.target.value)}
                  placeholder="Ví dụ: Cấp quyền truy cập kho tài liệu kỹ thuật"
                  className="mt-1.5 w-full rounded-xl border border-[#0D1321]/15 bg-white px-3.5 py-2.5 text-sm text-[#0D1321] focus:border-[#1B44FF] focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowInviteForm(false)}
                className="rounded-xl border border-[#0D1321]/12 bg-white px-4 py-2 text-sm font-semibold text-[#323B4D] hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busyKey === "invite"}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1B44FF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1635C7] disabled:opacity-60"
              >
                <Mail aria-hidden="true" className="size-4" />
                <span>{busyKey === "invite" ? "Đang gửi..." : "Tạo lời mời"}</span>
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* Pending Access Requests */}
      {pendingRequests.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40 p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-[#0D1321]">
                Yêu cầu truy cập chờ phê duyệt ({pendingRequests.length})
              </h3>
              <p className="text-xs text-[#52607A]">
                Các tài khoản cùng công ty đã đăng nhập Google nhưng chưa được cấp quyền truy cập.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {pendingRequests.map((req) => (
              <div
                key={req.requestRowId}
                className="flex flex-col gap-3 rounded-xl border border-amber-200/80 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-[#0D1321]">
                    {req.fullName || req.email || req.identityId}
                  </p>
                  <p className="text-xs text-[#52607A]">
                    {req.email ?? "Không có email"} ·{" "}
                    {REASON_LABELS[req.reasonClass] ?? req.reasonClass} ·{" "}
                    {formatDateTime(req.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyKey === `req:${req.requestRowId}`}
                    onClick={() => void handleResolveRequest(req.requestRowId, "APPROVE")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <UserCheck aria-hidden="true" className="size-3.5" />
                    <span>Phê duyệt</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === `req:${req.requestRowId}`}
                    onClick={() => void handleResolveRequest(req.requestRowId, "REJECT")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  >
                    <UserX aria-hidden="true" className="size-3.5" />
                    <span>Từ chối</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Members Directory */}
      <Card className="p-5">
        <div className="flex flex-col gap-3 border-b border-[#0D1321]/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Users aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <h3 className="text-base font-bold text-[#0D1321]">
              Danh sách thành viên ({filteredMembers.length})
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tên, email, phòng ban..."
                className="w-56 rounded-xl border border-[#0D1321]/12 bg-[#F8FAFC] py-2 pl-9 pr-3 text-xs text-[#0D1321] focus:border-[#1B44FF] focus:bg-white focus:outline-none"
              />
            </div>

            <select
              aria-label="Lọc theo vai trò"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-xl border border-[#0D1321]/12 bg-white px-3 py-2 text-xs font-medium text-[#323B4D]"
            >
              <option value="ALL">Tất cả vai trò</option>
              <option value="OWNER">Chủ sở hữu</option>
              <option value="ADMIN">Quản trị viên</option>
              <option value="MEMBER">Thành viên</option>
            </select>

            <select
              aria-label="Lọc theo trạng thái"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-[#0D1321]/12 bg-white px-3 py-2 text-xs font-medium text-[#323B4D]"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="ACTIVE">Đang hoạt động</option>
              <option value="SUSPENDED">Tạm khóa</option>
              <option value="DEPROVISIONED">Đã thu hồi</option>
            </select>
          </div>
        </div>

        {loading && !data ? (
          <div className="py-10 text-center text-sm text-[#64748B]">
            Đang tải danh sách thành viên từ cơ sở dữ liệu...
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#64748B]">
            Không tìm thấy thành viên nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#0D1321]/8 text-xs font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                  <th className="py-3 pr-4">Thành viên</th>
                  <th className="px-3 py-3">Phòng ban / OU</th>
                  <th className="px-3 py-3">Vai trò</th>
                  <th className="px-3 py-3">Trạng thái</th>
                  <th className="px-3 py-3">Phiên</th>
                  <th className="py-3 pl-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0D1321]/6">
                {filteredMembers.map((member) => {
                  const isBusy = busyKey === `member:${member.membershipId}`;
                  const canEditRole = isOwner || member.role !== "OWNER";

                  return (
                    <tr key={member.membershipId} className="hover:bg-[#F8FAFC]/80">
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-3">
                          {member.pictureUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={member.pictureUrl}
                              alt=""
                              className="size-9 rounded-full border border-[#0D1321]/10 object-cover"
                            />
                          ) : (
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#EEF1FF] text-xs font-bold text-[#1635C7]">
                              {initialsFrom(member.fullName, member.email)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate font-semibold text-[#0D1321]">
                                {member.fullName || member.email || member.userId}
                              </p>
                              {member.googleIsAdmin ? (
                                <span
                                  title="Google Workspace Admin"
                                  className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                                >
                                  <Shield aria-hidden="true" className="size-2.5" />
                                  GWS Admin
                                </span>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-[#64748B]">
                              {member.email ?? "Chưa đồng bộ email"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3.5 text-xs text-[#323B4D]">
                        {member.department ? (
                          <span className="font-medium">{member.department}</span>
                        ) : (
                          <span className="text-[#94A3B8]">—</span>
                        )}
                        {member.orgUnitPath ? (
                          <p className="text-[11px] text-[#64748B]">{member.orgUnitPath}</p>
                        ) : null}
                      </td>

                      <td className="px-3 py-3.5">
                        <select
                          aria-label={`Vai trò của ${member.email ?? member.userId}`}
                          value={member.role}
                          disabled={isBusy || !canEditRole}
                          onChange={(e) =>
                            void handleUpdateMember(member.membershipId, {
                              role: e.target.value,
                            })
                          }
                          className="rounded-lg border border-[#0D1321]/12 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0D1321] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        >
                          {isOwner || member.role === "OWNER" ? (
                            <option value="OWNER">{ROLE_LABELS.OWNER}</option>
                          ) : null}
                          <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                          <option value="MEMBER">{ROLE_LABELS.MEMBER}</option>
                        </select>
                      </td>

                      <td className="px-3 py-3.5">
                        <Badge
                          variant={
                            member.status === "ACTIVE"
                              ? "success"
                              : member.status === "SUSPENDED"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {STATUS_LABELS[member.status]}
                        </Badge>
                      </td>

                      <td className="px-3 py-3.5 text-xs font-medium text-[#52607A]">
                        {member.activeSessionCount}
                      </td>

                      <td className="py-3.5 pl-3 text-right">
                        {canEditRole ? (
                          member.status === "ACTIVE" ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleUpdateMember(member.membershipId, {
                                  status: "SUSPENDED",
                                })
                              }
                              className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                            >
                              Tạm khóa
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleUpdateMember(member.membershipId, {
                                  status: "ACTIVE",
                                })
                              }
                              className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Kích hoạt lại
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-[#94A3B8]">Bảo vệ</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pending Invites */}
      {data && data.invites.length > 0 ? (
        <Card className="p-5">
          <h3 className="text-base font-bold text-[#0D1321]">
            Lời mời thành viên ({data.invites.length})
          </h3>
          <div className="mt-3 divide-y divide-[#0D1321]/6">
            {data.invites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#0D1321]">
                      {invite.email}
                    </span>
                    <Badge variant="info">{invite.role}</Badge>
                    {invite.departmentKey ? (
                      <Badge variant="neutral">{invite.departmentKey}</Badge>
                    ) : null}
                    <Badge
                      variant={
                        invite.status === "PENDING"
                          ? "warning"
                          : invite.status === "ACCEPTED"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {invite.status === "PENDING"
                        ? "Đang chờ"
                        : invite.status === "ACCEPTED"
                          ? "Đã kích hoạt"
                          : invite.status === "REVOKED"
                            ? "Đã thu hồi"
                            : "Hết hạn"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-[#64748B]">
                    Tạo lúc {formatDateTime(invite.createdAt)} · Hết hạn{" "}
                    {formatDateTime(invite.expiresAt)}
                    {invite.note ? ` · ${invite.note}` : ""}
                  </p>
                </div>

                {invite.status === "PENDING" ? (
                  <button
                    type="button"
                    disabled={busyKey === `invite:${invite.id}`}
                    onClick={() => void handleRevokeInvite(invite.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    <span>Thu hồi</span>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Synced Google Directory Groups & OUs */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 aria-hidden="true" className="size-4 text-[#1B44FF]" />
            <h3 className="text-base font-bold text-[#0D1321]">
              Nhóm &amp; Đơn vị Google Directory
            </h3>
          </div>
          <Link
            href="/admin/connectors"
            className="text-xs font-semibold text-[#1B44FF] hover:underline"
          >
            Cấu hình kết nối Directory →
          </Link>
        </div>

        {!data || (data.groups.length === 0 && data.orgUnits.length === 0) ? (
          <p className="mt-3 text-sm text-[#64748B]">
            Chưa có nhóm hoặc đơn vị tổ chức nào được đồng bộ từ Google Workspace Directory.
            Khi kết nối Directory hoàn tất đồng bộ, toàn bộ Google Groups và Org Units của công ty sẽ tự động hiển thị tại đây.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.groups.map((group) => (
              <div
                key={group.googleGroupId}
                className="rounded-xl border border-[#0D1321]/10 bg-[#F8FAFC] p-3.5"
              >
                <p className="font-semibold text-[#0D1321]">{group.groupName}</p>
                <p className="mt-1 text-xs text-[#64748B]">
                  {group.memberCount} thành viên · ID: <code>{group.googleGroupId}</code>
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
