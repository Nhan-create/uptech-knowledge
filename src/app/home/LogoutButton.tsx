"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function logout() {
    setBusy(true);
    setFailure(null);
    try {
      const bootstrap = await fetch("/api/v1/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (bootstrap.status === 401) {
        router.replace("/login?error=session_expired");
        router.refresh();
        return;
      }
      if (!bootstrap.ok) {
        throw new Error("session bootstrap unavailable");
      }
      const payload = (await bootstrap.json()) as { csrf_token?: unknown };
      if (typeof payload.csrf_token !== "string") {
        throw new Error("session bootstrap is invalid");
      }
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-CSRF-Token": payload.csrf_token },
      });
      if (response.status === 204 || response.status === 401) {
        router.replace("/login");
        router.refresh();
        return;
      }
      throw new Error("logout was not committed");
    } catch {
      setFailure(
        "Chưa thể thu hồi phiên. Bạn vẫn đang đăng nhập; vui lòng thử lại.",
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={logout}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Đang đăng xuất…" : "Đăng xuất"}
      </button>
      {failure === null ? null : (
        <p role="alert" className="mt-3 text-sm leading-6 text-amber-200">
          {failure}
        </p>
      )}
    </div>
  );
}
