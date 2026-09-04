"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-[1.125rem] shrink-0"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.615Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.036-3.715H.957v2.333A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.282-1.706V4.961H.957A9 9 0 0 0 0 9c0 1.453.347 2.827.957 4.039l3.007-2.333Z" />
      <path fill="#EA4335" d="M9 3.579c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .957 4.961l3.007 2.333C4.672 5.164 6.656 3.579 9 3.579Z" />
    </svg>
  );
}

export function GoogleLoginSubmitButton({
  label = "Tiếp tục với Google Workspace",
  loadingLabel = "Đang chuyển đến Google…",
  disabled = false,
  busy = false,
}: {
  readonly label?: string;
  readonly loadingLabel?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}) {
  const submitStartedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const restoreButton = () => {
      submitStartedRef.current = false;
      setSubmitting(false);
    };
    window.addEventListener("pageshow", restoreButton);
    return () => window.removeEventListener("pageshow", restoreButton);
  }, []);

  return (
    <button
      data-testid="google-login-submit"
      type="submit"
      disabled={disabled || submitting}
      aria-busy={busy || submitting}
      onClick={(event) => {
        if (submitStartedRef.current) {
          event.preventDefault();
          return;
        }
        submitStartedRef.current = true;
        // The native POST preserves the existing OAuth transaction contract.
        // Defer disabling so the browser can include the submitter and navigate.
        window.setTimeout(() => setSubmitting(true), 0);
      }}
      className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-[#0f172a] shadow-sm transition-[background-color,box-shadow,color] hover:bg-slate-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] disabled:cursor-wait disabled:border-[#0f172a] disabled:bg-[#0f172a] disabled:text-white disabled:shadow-none"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {submitting ? (
          <LoaderCircle aria-hidden="true" className="size-[1.125rem] animate-spin" />
        ) : (
          <GoogleMark />
        )}
      </span>
      <span className="min-w-0">
        {submitting ? loadingLabel : label}
      </span>
    </button>
  );
}
