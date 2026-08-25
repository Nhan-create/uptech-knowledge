import type { CompareInput, DocumentListInput } from "@/features/knowledge/model";

export type RawDocumentParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function parseDocumentListParams(params: RawDocumentParams): DocumentListInput {
  const spaceId = firstParam(params.space).trim();
  const processing = firstParam(params.status).trim();
  const fileType = firstParam(params.type).trim();

  return {
    query: firstParam(params["document-query"]).trim(),
    spaceId: spaceId || undefined,
    processing: processing || undefined,
    fileType: fileType || undefined,
  };
}

export function parseCompareParams(params: RawDocumentParams): CompareInput {
  return {
    leftId: firstParam(params.left).trim() || undefined,
    rightId: firstParam(params.right).trim() || undefined,
  };
}
