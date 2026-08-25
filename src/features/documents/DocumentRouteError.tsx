"use client";

import { CircleAlert } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePrimitives";

export function DocumentRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <WorkspacePage>
      <section className="rounded-2xl border border-rose-900/60 bg-rose-950/20 px-5 py-12 text-center">
        <CircleAlert aria-hidden="true" className="mx-auto size-9 text-rose-300" />
        <h1 className="mt-4 text-xl font-semibold text-white">Không thể đọc dữ liệu fixture</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">Đây là lỗi render hoặc adapter cục bộ; không nên diễn giải thành lỗi quyền hay trạng thái của tài liệu thật.</p>
        <button type="button" onClick={reset} className="mt-5 min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">Thử render lại</button>
      </section>
    </WorkspacePage>
  );
}
