import type { Metadata } from "next";
import { UtilityWorkbench } from "@/components/workspace/UtilityWorkbench";
import {
  DemoNotice,
  PageIntro,
  StatePreview,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";

export const metadata: Metadata = {
  title: "Tiện ích AI",
};

export default function UtilityPage() {
  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="AI Utilities · Prototype"
        title="Từ tài liệu thành bản nháp có thể kiểm tra"
        description="Chọn một tác vụ, xem nguồn đầu vào và chỉnh sửa kết quả minh họa trước mọi hành động tiếp theo. Không có tác vụ nào tự gửi, xuất bản hay tạo dữ liệu thật."
      />
      <DemoNotice className="mt-6" />
      <UtilityWorkbench />
      <StatePreview
        id="utility-state-heading"
        title="AI Utilities"
        description="Đầu ra luôn là bản nháp có thể kiểm tra; các trạng thái nền dưới đây không tự gửi hay xuất bản nội dung."
        states={[
          {
            label: "Đang xếp hàng",
            description: "Hiển thị vị trí và cho phép hủy trước khi tác vụ bắt đầu.",
            tone: "slate",
          },
          {
            label: "Đang tạo",
            description: "Giữ nguồn đầu vào, tiến trình và hành động hủy trong cùng ngữ cảnh.",
            tone: "blue",
          },
          {
            label: "Bản nháp một phần",
            description: "Nêu phần nào đã hoàn tất, phần nào thiếu và vẫn yêu cầu kiểm tra.",
            tone: "amber",
          },
          {
            label: "Lỗi có thể thử lại",
            description: "Giữ cấu hình không nhạy cảm và cung cấp lối thử lại rõ ràng.",
            tone: "rose",
          },
        ]}
      />
      <section
        id="tro-giup"
        aria-labelledby="help-heading"
        className="mt-8 scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900/55 p-5 sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-300">
          Hướng dẫn prototype
        </p>
        <h2 id="help-heading" className="mt-2 text-lg font-semibold text-white">
          Luôn kiểm tra nguồn trước khi dùng bản nháp
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Chọn tác vụ, xác nhận tài liệu đầu vào, đọc lại nội dung và đánh dấu đã
          kiểm tra. Bản mẫu này không tự gửi email, xuất bản nội dung hay tạo công
          việc thật.
        </p>
      </section>
    </WorkspacePage>
  );
}
