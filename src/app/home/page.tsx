import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import Logo from "@/components/Logo";
import { loadWebSessionRuntimeConfig } from "@/server/auth/google/config";
import {
  authenticateWebSession,
  WebSessionAuthenticationError,
} from "@/server/auth/web-session";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import { requestIdFromHeaders } from "@/server/http/problem";
import { classifyRequestCredential } from "@/server/http/request-security";
import { logAuthOperation } from "@/server/auth/operational-log";

import { LogoutButton } from "./LogoutButton";

export const metadata: Metadata = { title: "Trang chủ" };
export const dynamic = "force-dynamic";

export default async function AuthenticatedHomePage() {
  let session;
  const requestHeaders = await headers();
  const operationRequestId = requestIdFromHeaders(requestHeaders);
  const credential = classifyRequestCredential(requestHeaders);
  if (!credential.ok || credential.kind !== "cookie") {
    redirect("/login");
  }
  try {
    const config = loadWebSessionRuntimeConfig();
    session = await authenticateWebSession(
      requestHeaders,
      config.sessionPepper,
      getRuntimeDatabasePool(config.databaseUrl),
    );
  } catch (error) {
    if (error instanceof WebSessionAuthenticationError) {
      redirect("/login");
    }
    throw error;
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
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Google Workspace đã xác minh
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
          Đăng nhập thành công
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Phiên truy cập đang hoạt động với vai trò {session.context.workspaceRole}.
          Các khu vực sản phẩm khác vẫn đóng cho đến khi hoàn tất các phase tương ứng.
        </p>
        <div className="mt-8">
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
