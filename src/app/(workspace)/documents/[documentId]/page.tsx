import type { Metadata } from "next";
import { DocumentDetailScreen } from "@/features/documents/DocumentRouteScreens";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const metadata: Metadata = { title: "Chi tiết tài liệu" };

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const adapter = getKnowledgeReadAdapter();
  const [outcome, spaces] = await Promise.all([
    adapter.getDocument(documentId),
    adapter.listSpaces(),
  ]);
  return <DocumentDetailScreen outcome={outcome} spaces={spaces} />;
}
