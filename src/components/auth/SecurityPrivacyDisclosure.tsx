"use client";

import { useId, useRef } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import type { Locale } from "@/lib/preferences";

const securityCopy = {
  vi: {
    trigger: "Bảo mật & quyền riêng tư",
    title: "Bảo mật khi đăng nhập",
    description: "Những điều bạn cần biết trước khi tiếp tục.",
    close: "Đóng thông tin bảo mật",
    understood: "Đã hiểu",
    points: [
      "Google trực tiếp xác minh danh tính của bạn.",
      "UPTECH không nhận mật khẩu Google.",
      "UPTECH chỉ yêu cầu tên, email và thông tin hồ sơ cơ bản.",
      "Quyền truy cập được xác định bởi workspace của tổ chức.",
      "Phiên đăng nhập có thể bị thu hồi khi quản trị viên vô hiệu hóa quyền truy cập.",
    ],
  },
  en: {
    trigger: "Security & privacy",
    title: "Secure sign-in",
    description: "What you should know before continuing.",
    close: "Close security information",
    understood: "Understood",
    points: [
      "Google verifies your identity directly.",
      "UPTECH never receives your Google password.",
      "UPTECH only requests your name, email, and basic profile information.",
      "Your organization workspace determines access permissions.",
      "A session can be revoked when an administrator disables access.",
    ],
  },
} as const;

export function SecurityPrivacyDisclosure({ locale }: { readonly locale: Locale }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const copy = securityCopy[locale];

  const closeDialog = () => dialogRef.current?.close();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-medium text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        <ShieldCheck aria-hidden="true" className="size-4 text-blue-300" />
        {copy.trigger}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-modal="true"
        onClose={() => triggerRef.current?.focus({ preventScroll: true })}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        className="fixed inset-0 m-auto w-[min(30rem,calc(100vw-1.5rem))] max-w-none rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0 text-left text-[var(--text-primary)] shadow-[0_30px_100px_rgba(2,6,23,0.58)] backdrop:bg-slate-950/75 backdrop:backdrop-blur-sm sm:rounded-3xl"
      >
        <div className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-400/10 text-blue-300">
                <ShieldCheck aria-hidden="true" className="size-5" />
              </span>
              <div>
                <h2 id={titleId} className="text-lg font-semibold tracking-[-0.02em] text-slate-100">
                  {copy.title}
                </h2>
                <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-400">
                  {copy.description}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              aria-label={copy.close}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>

          <ul className="mt-6 space-y-3.5">
            {copy.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm leading-6 text-slate-300">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                  <Check aria-hidden="true" className="size-3" />
                </span>
                {point}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={closeDialog}
            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elevated)]"
          >
            {copy.understood}
          </button>
        </div>
      </dialog>
    </>
  );
}
