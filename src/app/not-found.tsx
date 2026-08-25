import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import Logo from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[var(--bg-primary)] px-6 text-slate-100">
      <div aria-hidden="true" className="tech-grid absolute inset-0 opacity-70" />
      <div className="relative z-10 w-full max-w-lg text-center">
        <Logo className="mx-auto h-8" />
        <div className="mx-auto mt-12 grid size-16 place-items-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-blue-300">
          <Compass aria-hidden="true" className="size-7" />
        </div>
        <p className="mt-7 font-data text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
          Error 404
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
          Trang này chưa có trong kho tri thức
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 text-slate-400">
          Liên kết có thể đã thay đổi hoặc màn hình này chưa được đưa vào bản prototype.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-5 text-sm font-semibold text-slate-100 transition-colors hover:border-blue-400/50 hover:bg-slate-800"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}
