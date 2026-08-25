"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <section className="surface-panel w-full max-w-lg rounded-2xl p-7 text-center" role="alert">
        <div className="mx-auto grid size-12 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
          <AlertTriangle aria-hidden="true" className="size-6" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">Chưa thể tải màn hình này</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Ngữ cảnh của bạn vẫn được giữ. Hãy thử tải lại nội dung; nếu lỗi tiếp diễn, quay lại sau.
        </p>
        <Button className="mt-6" onClick={reset}>
          <RotateCcw aria-hidden="true" className="size-4" />
          Thử lại
        </Button>
      </section>
    </div>
  );
}
