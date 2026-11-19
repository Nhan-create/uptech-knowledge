"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  CreditCard,
  FileClock,
  Globe,
  PlugZap,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspacePage } from "@/components/workspace/WorkspacePrimitives";
import type { AdminShellMetadata } from "@/server/admin/repository";

const adminNavigation = [
  { href: "/admin/users", label: "Người dùng", icon: Users },
  { href: "/admin/permissions", label: "Quyền", icon: ShieldCheck },
  { href: "/admin/connectors", label: "Kết nối", icon: PlugZap },
  { href: "/admin/billing", label: "Thanh toán", icon: CreditCard },
  { href: "/admin/audit-logs", label: "Nhật ký", icon: FileClock },
  { href: "/admin/settings", label: "Thiết lập", icon: Settings },
] as const;

export function AdminScaffold({
  children,
  shellMetadata,
}: {
  children: ReactNode;
  shellMetadata: AdminShellMetadata | null;
}) {
  const pathname = usePathname();
  const roleLabel =
    shellMetadata?.callerRole === "OWNER"
      ? "Chủ sở hữu · OWNER"
      : "Quản trị viên · ADMIN";
  const policyLabel =
    shellMetadata?.provisioningPolicy === "GOOGLE_GROUP_CONTROLLED"
      ? "Đồng bộ Google Directory"
      : "Quản trị mời thành viên";

  return (
    <WorkspacePage>
      <header className="flex flex-col gap-4 rounded-2xl border border-[#0D1321]/10 bg-white p-5 shadow-[0_1px_2px_rgba(13,19,33,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#EEF1FF] text-[#1B44FF]">
            <Building2 aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1B44FF]">
                Quản trị tổ chức
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/80">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {roleLabel}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                {policyLabel}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-lg font-bold tracking-[-0.02em] text-[#0D1321]">
                {shellMetadata?.organizationName ?? "UPTECH Knowledge Organization"}
              </h1>
              {shellMetadata?.primaryDomain ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#52607A]">
                  <Globe aria-hidden="true" className="size-3.5" />
                  {shellMetadata.primaryDomain}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#0D1321]/12 bg-[#F8FAFC] px-3.5 text-sm font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF]/40 hover:bg-[#EEF1FF] hover:text-[#1635C7]"
          >
            <span>Không gian làm việc</span>
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </header>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[224px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Điều hướng quản trị">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {adminNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              const pendingCount =
                item.href === "/admin/users"
                  ? (shellMetadata?.pendingAccessRequestCount ?? 0)
                  : 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]"
                        : "border-[#0D1321]/10 bg-white text-[#323B4D] hover:border-[#C8D2FF] hover:text-[#0D1321]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {pendingCount > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        {pendingCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </WorkspacePage>
  );
}
