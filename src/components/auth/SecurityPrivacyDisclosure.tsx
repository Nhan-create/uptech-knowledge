import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import type { Locale } from "@/lib/preferences";

const legalCopy = {
  vi: {
    label: "Thông tin pháp lý",
    terms: "Điều khoản sử dụng",
    privacy: "Chính sách bảo mật",
  },
  en: {
    label: "Legal information",
    terms: "Terms of Use",
    privacy: "Privacy Policy",
  },
} as const;

export function SecurityPrivacyDisclosure({ locale }: { readonly locale: Locale }) {
  const copy = legalCopy[locale];

  return (
    <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-300">
      <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-blue-300" />
      <nav aria-label={copy.label} className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Link
          href="/dieu-khoan-su-dung"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center rounded-md px-1 underline decoration-slate-600 underline-offset-4 transition-colors hover:text-white hover:decoration-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {copy.terms}
        </Link>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <Link
          href="/chinh-sach-bao-mat"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center rounded-md px-1 underline decoration-slate-600 underline-offset-4 transition-colors hover:text-white hover:decoration-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {copy.privacy}
        </Link>
      </nav>
    </div>
  );
}
