import type { Metadata } from "next";
import { DocumentDetailScreen } from "@/features/documents/DocumentRouteScreens";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const metadata: Metadata = { title: "Chi tiết tài liệu" };

export default async function DocumentDetailPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const outcome = await getKnowledgeReadAdapter().getDocument(documentId);
  return <DocumentDetailScreen outcome={outcome} />;
}
