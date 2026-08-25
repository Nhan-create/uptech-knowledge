import type { SearchInput } from "@/features/knowledge/model";

export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function parseSearchParams(params: RawSearchParams): SearchInput {
  const spaceId = firstValue(params.space).trim();
  const fileType = firstValue(params.type).trim();

  return {
    query: firstValue(params.q).trim(),
    spaceId: spaceId && spaceId !== "all" ? spaceId : undefined,
    fileType: fileType && fileType !== "all" ? fileType : undefined,
  };
}
