import { BookOpenCheck, CircleHelp, FileWarning, LockKeyhole } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import {
  DemoNotice,
  PageIntro,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";

const previewCards = [
  {
    kind: "Decision card preview",
    title: "Quy ước lịch làm việc phân tán",
    summary: "Ví dụ bố cục cho bối cảnh, lựa chọn và hệ quả của một quyết định.",
    icon: BookOpenCheck,
  },
  {
    kind: "Open-question card preview",
    title: "Ai xác nhận ngoại lệ chính sách?",
    summary: "Ví dụ bố cục cho câu hỏi còn mở, không phải OQ có trạng thái thật.",
    icon: CircleHelp,
  },
] as const;

export function KnowledgeContractGapScreen() {
  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Knowledge cards · Contract gap"
        title="Thẻ tri thức chưa có hợp đồng dữ liệu"
        description="Route read-only để đánh giá bố cục ADR/OQ dự kiến. Các thẻ dưới đây không phải entity trong adapter tài liệu và không có ID, workflow hay quyền thật."
      />
      <DemoNotice className="mt-6" />

      <section aria-labelledby="contract-gap-heading" className="mt-6 rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-800/60 bg-amber-950/60 text-amber-300"><FileWarning aria-hidden="true" className="size-5" /></span>
          <div>
            <h2 id="contract-gap-heading" className="font-semibold text-amber-100">Chưa chốt ADR/OQ contract</h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">Thiếu schema định danh, lifecycle, provenance, verification, publish và authorization. Vì vậy route này chỉ preview presentation, không gọi adapter và không tạo record giả.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="knowledge-preview-heading" className="mt-8">
        <SectionHeading id="knowledge-preview-heading" title="Preview bố cục fixture" description="Mỗi thẻ được gắn nhãn presentation-only; nội dung không đại diện dữ liệu đã trích xuất hay được xác minh." />
        <div className="grid gap-4 lg:grid-cols-2">
          {previewCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.kind} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex size-10 items-center justify-center rounded-xl border border-violet-800/60 bg-violet-950/50 text-violet-300"><Icon aria-hidden="true" className="size-5" /></span>
                  <Badge variant="warning" size="sm">Fixture preview</Badge>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-violet-300">{card.kind}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.summary}</p>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                  <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-lg bg-slate-800 px-3 text-xs font-semibold text-slate-500">Verify · chưa có contract</button>
                  <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-lg border border-slate-800 px-3 text-xs font-semibold text-slate-600">Publish · chưa có contract</button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="contract-needs-heading" className="mt-8">
        <SectionHeading id="contract-needs-heading" title="Điều kiện trước khi bật tương tác" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {["Opaque ID và version semantics", "Provenance/citation bắt buộc", "Role + permission cho verify/publish", "Audit trail và conflict handling"].map((item) => (
            <li key={item} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300"><LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-slate-500" />{item}</li>
          ))}
        </ul>
      </section>
    </WorkspacePage>
  );
}
