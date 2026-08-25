import type {
  CompareInput,
  CompareOutcome,
  DocumentListInput,
  DocumentListOutcome,
  DocumentLookupOutcome,
  SearchInput,
  SearchOutcome,
  SpaceLookupOutcome,
  SpaceSummaryView,
} from "@/features/knowledge/model";

export interface KnowledgeReadAdapter {
  listSpaces(): Promise<readonly SpaceSummaryView[]>;
  listDocuments(input: DocumentListInput): Promise<DocumentListOutcome>;
  search(input: SearchInput): Promise<SearchOutcome>;
  getDocument(documentId: string): Promise<DocumentLookupOutcome>;
  getSpace(spaceId: string): Promise<SpaceLookupOutcome>;
  compare(input: CompareInput): Promise<CompareOutcome>;
  findDocumentIdByLegacyName(name: string): Promise<string | undefined>;
  findSpaceIdByLegacyName(name: string): Promise<string | undefined>;
}
