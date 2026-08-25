import type { Metadata } from "next";
import { KnowledgeContractGapScreen } from "@/features/knowledge/KnowledgeContractGapScreen";

export const metadata: Metadata = { title: "Thẻ tri thức" };

export default function KnowledgePage() {
  return <KnowledgeContractGapScreen />;
}
