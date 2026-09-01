import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import Logo from "@/components/Logo";
import { requestIdFromHeaders } from "@/server/http/problem";
import { logAuthOperation } from "@/server/auth/operational-log";
import { resolveWebRouteAuthority } from "@/server/auth/web-route-authority";

import { LogoutButton } from "./LogoutButton";

export const metadata: Metadata = { title: "Trang chủ" };
export const dynamic = "force-dynamic";

export default async function AuthenticatedHomePage() {
  const requestHeaders = await headers();
  const operationRequestId = requestIdFromHeaders(requestHeaders);
  const authority = await resolveWebRouteAuthority(requestHeaders, "HOME");
  if (authority === "ADMIN") redirect("/admin");
  if (authority === "LOGIN") redirect("/login?error=session_expired");
  if (authority !== "ALLOW") {
    throw new Error("Unexpected home route authority");
  }

  logAuthOperation({
    requestId: operationRequestId,
    operation: "HOME_AUTHORIZATION",
    outcome: "AUTHORIZED",
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--bg-primary)] px-5 text-slate-100">
      <section className="w-full max-w-xl rounded-3xl border border-slate-700/80 bg-[var(--bg-surface)] p-7 shadow-[var(--panel-shadow)] sm:p-10">
        <Logo className="h-8 w-auto" />
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
          UPTECH KNOWLEDGE
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
          Chào mừng bạn trở lại
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Phiên đăng nhập của bạn đang hoạt động. Nội dung và công cụ chỉ được
          hiển thị theo quyền truy cập mà tổ chức đã cấp.
        </p>
        <div className="mt-8">
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
