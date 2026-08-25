import type { Metadata } from "next";

import { DashboardScreen } from "@/features/dashboard/DashboardScreen";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const metadata: Metadata = {
  title: "Tổng quan",
};

export default async function DashboardPage() {
  const adapter = getKnowledgeReadAdapter();
  const [spaces, documentOutcome] = await Promise.all([
    adapter.listSpaces(),
    adapter.listDocuments({ query: "" }),
  ]);
  const documents =
    documentOutcome.kind === "ready" ? documentOutcome.documents : [];

  return <DashboardScreen spaces={spaces} documents={documents} />;
}
