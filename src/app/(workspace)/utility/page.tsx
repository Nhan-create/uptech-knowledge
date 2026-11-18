import Link from "next/link";
import { GitCompareArrows } from "lucide-react";

import { UtilityWorkbench } from "@/components/workspace/UtilityWorkbench";
import { PageIntro, WorkspacePage } from "@/components/workspace/WorkspacePrimitives";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const dynamic = "force-dynamic";

export default async function UtilityPage() {
  const adapter = getKnowledgeReadAdapter();
  const [docOutcome, spaces] = await Promise.all([
    adapter.listDocuments({ query: "", processing: "ready" }),
    adapter.listSpaces(),
  ]);

  const documents = docOutcome.kind === "ready" ? docOutcome.documents : [];

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="AI Utilities · Trợ lý tài liệu"
        title="Xưởng tiện ích AI"
        description="Biến tài liệu nội bộ hoặc đoạn văn bản bất kỳ thành tóm tắt điều hành, checklist thực thi, bản dịch đa ngôn ngữ, báo cáo phân tích hoặc email chuyên nghiệp."
        actions={
          <Link href="/documents/compare" className="glean-btn glean-btn-secondary glean-btn-sm">
            <GitCompareArrows aria-hidden="true" className="size-3.5" />
            <span>So sánh 2 tài liệu</span>
          </Link>
        }
      />

      <UtilityWorkbench documents={documents} spaces={spaces} />
    </WorkspacePage>
  );
}
