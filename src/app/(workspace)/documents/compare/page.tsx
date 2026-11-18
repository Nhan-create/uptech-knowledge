import type { Metadata } from "next";
import { CompareScreen } from "@/features/documents/DocumentRouteScreens";
import { parseCompareParams, type RawDocumentParams } from "@/features/documents/document-params";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const metadata: Metadata = { title: "So sánh tài liệu" };

export const dynamic = "force-dynamic";

export default async function DocumentComparePage({ searchParams }: { searchParams: Promise<RawDocumentParams> }) {
  const adapter = getKnowledgeReadAdapter();
  const input = parseCompareParams(await searchParams);
  const [outcome, readyList] = await Promise.all([
    adapter.compare(input),
    adapter.listDocuments({ query: "", processing: "ready" }),
  ]);
  const readyDocuments = readyList.kind === "ready" ? readyList.documents : [];
  return <CompareScreen input={input} outcome={outcome} readyDocuments={readyDocuments} />;
}
