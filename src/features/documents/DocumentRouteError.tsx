"use client";

import { CircleAlert } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePrimitives";

export function DocumentRouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <WorkspacePage>
      <section className="rounded-2xl border border-[#FACACA] bg-[#FFF8F8] px-5 py-12 text-center">
        <CircleAlert aria-hidden="true" className="mx-auto size-9 text-[#B32018]" />
        <h1 className="mt-4 text-xl font-bold text-[#0D1321]">
          Không thể đọc dữ liệu fixture
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
          Đây là lỗi render hoặc adapter cục bộ; không nên diễn giải thành lỗi quyền
          hay trạng thái của tài liệu thật.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 min-h-11 rounded-full bg-[#1B44FF] px-5 text-sm font-semibold [color:#FFFFFF] hover:bg-[#1436D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF]"
        >
          Thử render lại
        </button>
      </section>
    </WorkspacePage>
  );
}
