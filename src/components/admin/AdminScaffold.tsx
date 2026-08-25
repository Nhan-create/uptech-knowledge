"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  FileClock,
  PlugZap,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspacePage } from "@/components/workspace/WorkspacePrimitives";

const adminNavigation = [
  { href: "/admin/users", label: "Người dùng", icon: Users },
  { href: "/admin/permissions", label: "Quyền", icon: ShieldCheck },
  { href: "/admin/connectors", label: "Kết nối", icon: PlugZap },
  { href: "/admin/billing", label: "Thanh toán", icon: CreditCard },
  { href: "/admin/audit-logs", label: "Nhật ký", icon: FileClock },
  { href: "/admin/settings", label: "Thiết lập", icon: Settings },
] as const;

export function AdminScaffold({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <WorkspacePage>
      <aside
        aria-label="Giới hạn của bản mẫu quản trị"
        className="flex items-start gap-3 rounded-xl border border-amber-900/70 bg-amber-950/30 p-4 text-sm text-amber-100"
      >
        <ShieldAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-amber-400"
        />
        <p className="leading-6">
          <span className="font-semibold text-amber-200">
            Khu vực quản trị · fixture UI.
          </span>{" "}
          Việc mở URL này không xác nhận vai trò hay quyền quản trị. Sản phẩm thật
          phải kiểm tra ủy quyền ở máy chủ trước khi trả dữ liệu hoặc cho phép thao
          tác.
        </p>
      </aside>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Điều hướng quản trị">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {adminNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      active
                        ? "border-blue-700 bg-blue-950/45 text-blue-200"
                        : "border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span>{item.label}</span>
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
