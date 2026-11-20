import type { Metadata } from "next";
import { headers } from "next/headers";

import { KnowledgeCardsWorkbench } from "@/features/knowledge/KnowledgeCardsWorkbench";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";
import { resolveWorkspaceServerAccess } from "@/server/knowledge/access-context";
import {
  listKnowledgeCards,
  type KnowledgeCardRecord,
} from "@/server/knowledge/repository";

export const metadata: Metadata = { title: "Thẻ tri thức" };

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const adapter = getKnowledgeReadAdapter();
  const access = await resolveWorkspaceServerAccess(await headers());
  const [spaces, docOutcome, cards] = await Promise.all([
    adapter.listSpaces(),
    adapter.listDocuments({ query: "", processing: "ready" }),
    access
      ? listKnowledgeCards(access).catch(
          (): readonly KnowledgeCardRecord[] => [],
        )
      : Promise.resolve<readonly KnowledgeCardRecord[]>([]),
  ]);

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
