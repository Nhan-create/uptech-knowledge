import type { Metadata } from "next";

import {
  ChatDemo,
  type ChatFixtureScope,
} from "@/components/workspace/ChatDemo";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";
import type { DocumentDetailView } from "@/features/knowledge/model";

export const metadata: Metadata = {
  title: "Trợ lý AI",
};

export const dynamic = "force-dynamic";

type ChatSearchParams = Readonly<{
  prompt?: string | string[];
  scope?: string | string[];
}>;

function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getFixtureScope(value: string | undefined): ChatFixtureScope {
  switch (value) {
    case "hr":
    case "operations":
    case "atlas":
      return value;
    default:
      return "workspace";
  }
}

export default async function ChatPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<ChatSearchParams>;
}>) {
  const query = await searchParams;
  const initialPrompt = getFirstSearchParam(query.prompt) ?? "";
  const initialScope = getFixtureScope(getFirstSearchParam(query.scope));

  const adapter = getKnowledgeReadAdapter();
  const [spaces, documentOutcome] = await Promise.all([
    adapter.listSpaces(),
    adapter.listDocuments({ query: "" }),
  ]);
  const documents =
    documentOutcome.kind === "ready" ? documentOutcome.documents : [];
  const readyDetails = (
    await Promise.all(
      documents
        .filter((doc) => doc.processing.kind === "ready")
        .map(async (doc) => {
          const lookup = await adapter.getDocument(doc.id);
          return lookup.kind === "found" ? lookup.document : null;
        }),
    )
  ).filter((doc): doc is DocumentDetailView => doc !== null);

  return (
    <ChatDemo
      key={`${initialScope}:${initialPrompt}`}
      initialPrompt={initialPrompt}
      initialScope={initialScope}
      spaces={spaces}
      documents={documents}
      readyDetails={readyDetails}
    />
  );
}
