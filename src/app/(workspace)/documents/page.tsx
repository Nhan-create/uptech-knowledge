import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DocumentLibraryScreen } from "@/features/documents/DocumentLibraryScreen";
import {
  firstParam,
  parseDocumentListParams,
  type RawDocumentParams,
} from "@/features/documents/document-params";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";

export const metadata: Metadata = { title: "Tài liệu" };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<RawDocumentParams>;
}) {
  const params = await searchParams;
  const adapter = getKnowledgeReadAdapter();
  const requestedDocument = firstParam(params.document).trim();
  let legacyLinkUnavailable = false;

  if (requestedDocument) {
    const directLookup = await adapter.getDocument(requestedDocument);
    if (directLookup.kind === "found") {
      redirect(`/documents/${directLookup.document.id}`);
    }

    const legacyDocumentId = await adapter.findDocumentIdByLegacyName(requestedDocument);
    if (legacyDocumentId) {
      redirect(`/documents/${legacyDocumentId}`);
    }
    legacyLinkUnavailable = true;
  }

  const parsedInput = parseDocumentListParams(params);
  const legacySpaceId = parsedInput.spaceId
    ? await adapter.findSpaceIdByLegacyName(parsedInput.spaceId)
    : undefined;
  const input = {
    ...parsedInput,
    spaceId: legacySpaceId ?? parsedInput.spaceId,
  };
  const [spaces, outcome] = await Promise.all([
    adapter.listSpaces(),
    adapter.listDocuments(input),
  ]);

  return (
    <DocumentLibraryScreen
      input={input}
      outcome={outcome}
      spaces={spaces}
      legacyLinkUnavailable={legacyLinkUnavailable}
    />
  );
}
