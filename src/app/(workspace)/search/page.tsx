import type { Metadata } from "next";
import { getKnowledgeReadAdapter } from "@/features/knowledge/get-read-adapter";
import { SearchScreen } from "@/features/search/SearchScreen";
import {
  parseSearchParams,
  type RawSearchParams,
} from "@/features/search/search-params";

export const metadata: Metadata = {
  title: "Tìm kiếm",
};

export const dynamic = "force-dynamic";

const legacySpaceNames: Record<string, string> = {
  people: "Nhân sự",
  operations: "Vận hành",
  projects: "Dự án Atlas",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const adapter = getKnowledgeReadAdapter();
  const parsedInput = parseSearchParams(await searchParams);
  const legacySpaceName = parsedInput.spaceId
    ? legacySpaceNames[parsedInput.spaceId]
    : undefined;
  const resolvedSpaceId = legacySpaceName
    ? await adapter.findSpaceIdByLegacyName(legacySpaceName)
    : parsedInput.spaceId;
  const input = { ...parsedInput, spaceId: resolvedSpaceId };
  const [spaces, outcome, readyList] = await Promise.all([
    adapter.listSpaces(),
    adapter.search(input),
    adapter.listDocuments({ query: "", processing: "ready" }),
  ]);
  const readyDocuments = readyList.kind === "ready" ? readyList.documents : [];

  return (
    <SearchScreen
      input={input}
      outcome={outcome}
      spaces={spaces}
      readyDocuments={readyDocuments}
    />
  );
}
