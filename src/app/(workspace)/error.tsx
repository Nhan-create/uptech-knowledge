"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <section
        className="w-full max-w-lg rounded-2xl border border-[#0D1321]/10 bg-white p-7 text-center shadow-[0_12px_24px_-6px_rgba(11,18,32,0.1)]"
        role="alert"
      >
        <div className="mx-auto grid size-12 place-items-center rounded-xl border border-[#F6D59B] bg-[#FFF3DE] text-[#924D05]">
          <AlertTriangle aria-hidden="true" className="size-6" />
        </div>
        <h1 className="mt-5 text-xl font-bold text-[#0D1321]">
          Chưa thể tải màn hình này
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#505A6E]">
          Ngữ cảnh của bạn vẫn được giữ. Hãy thử tải lại nội dung; nếu lỗi tiếp
          diễn, quay lại sau.
        </p>
        <Button className="mt-6" onClick={reset}>
          <RotateCcw aria-hidden="true" className="size-4" />
          Thử lại
        </Button>
      </section>
    </div>
  );
}
