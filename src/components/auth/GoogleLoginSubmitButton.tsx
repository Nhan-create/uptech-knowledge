"use client";

import { useState } from "react";

export function GoogleLoginSubmitButton() {
  const [submitting, setSubmitting] = useState(false);

  return (
    <button
      type="submit"
      disabled={submitting}
      onClick={() => setSubmitting(true)}
      aria-describedby="login-description"
      className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-wait disabled:opacity-70"
    >
      {submitting
        ? "Đang chuyển đến Google…"
        : "Đăng nhập bằng Google Workspace"}
    </button>
  );
}
