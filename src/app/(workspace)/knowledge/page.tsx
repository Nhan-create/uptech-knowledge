import type { Metadata } from "next";

import { KnowledgeCardsWorkbench } from "@/features/knowledge/KnowledgeCardsWorkbench";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";
import {
  getPreviewWorkspaceContext,
  isWorkspacePreviewModeEnabled,
} from "@/server/knowledge/access-context";
import {
  listKnowledgeCards,
  type KnowledgeCardRecord,
} from "@/server/knowledge/repository";

export const metadata: Metadata = { title: "Thẻ tri thức" };

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const adapter = getKnowledgeReadAdapter();
  const [spaces, docOutcome] = await Promise.all([
    adapter.listSpaces(),
    adapter.listDocuments({ query: "", processing: "ready" }),
  ]);

  let cards: readonly KnowledgeCardRecord[] = [];
  if (isWorkspacePreviewModeEnabled()) {
    cards = await listKnowledgeCards(getPreviewWorkspaceContext()).catch(() => []);
  }

  const readyDocuments =
    docOutcome.kind === "ready" ? docOutcome.documents : [];

  return (
    <KnowledgeCardsWorkbench
      initialCards={cards}
      spaces={spaces}
      readyDocuments={readyDocuments}
    />
  );
}
