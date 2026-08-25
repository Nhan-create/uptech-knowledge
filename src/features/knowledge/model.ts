export const FILE_TYPES = ["pdf", "docx", "md"] as const;
export const PROCESSING_KINDS = [
  "uploading",
  "validating",
  "extracting",
  "ocr",
  "indexing",
  "ready",
  "failed",
] as const;

declare const documentIdBrand: unique symbol;
declare const spaceIdBrand: unique symbol;

export type DocumentId = string & { readonly [documentIdBrand]: "DocumentId" };
export type SpaceId = string & { readonly [spaceIdBrand]: "SpaceId" };
export type FileType = (typeof FILE_TYPES)[number];
export type ProcessingKind = (typeof PROCESSING_KINDS)[number];
export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

export type ProcessingState = Readonly<{
  kind: ProcessingKind;
  label: string;
  description: string;
  progress?: number;
}>;

export type GovernanceMarker = Readonly<{
  kind:
    | "official"
    | "verified"
    | "needs-review"
    | "expiring"
    | "expired"
    | "deprecated";
  label: string;
  description: string;
  variant: BadgeVariant;
}>;

export type SpaceSummaryView = Readonly<{
  id: SpaceId;
  name: string;
  description: string;
  documentCount: number;
}>;

export type DocumentSummaryView = Readonly<{
  id: DocumentId;
  name: string;
  fileType: FileType;
  versionLabel: string;
  detail: string;
  ownerLabel: string;
  updatedLabel: string;
  space: Pick<SpaceSummaryView, "id" | "name">;
  processing: ProcessingState;
  governance: readonly GovernanceMarker[];
}>;

export type DocumentDetailView = DocumentSummaryView &
  Readonly<{
    versions: readonly Readonly<{
      id: string;
      label: string;
      updatedLabel: string;
    }>[];
    preview:
      | Readonly<{
          kind: "fixture-excerpt";
          heading: string;
          locator: string;
          excerpt: string;
        }>
      | Readonly<{
          kind: "unavailable";
          reason: string;
        }>;
  }>;

export type SearchInput = Readonly<{
  query: string;
  spaceId?: string;
  fileType?: string;
}>;

export type SearchResultView = Readonly<{
  document: DocumentSummaryView;
  snippet: string;
  locator: string;
}>;

export type SearchOutcome =
  | Readonly<{ kind: "initial" }>
  | Readonly<{ kind: "results"; query: string; results: readonly SearchResultView[] }>
  | Readonly<{
      kind: "indexing";
      query: string;
      documents: readonly DocumentSummaryView[];
    }>
  | Readonly<{ kind: "empty"; query: string }>
  | Readonly<{ kind: "invalid"; fields: readonly string[] }>;

export type DocumentListInput = Readonly<{
  query: string;
  spaceId?: string;
  processing?: string;
  fileType?: string;
}>;

export type DocumentListOutcome =
  | Readonly<{ kind: "ready"; documents: readonly DocumentSummaryView[] }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "invalid"; fields: readonly string[] }>;

export type DocumentLookupOutcome =
  | Readonly<{ kind: "found"; document: DocumentDetailView }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export type SpaceLookupOutcome =
  | Readonly<{
      kind: "found";
      space: SpaceSummaryView;
      documents: readonly DocumentSummaryView[];
    }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export type CompareInput = Readonly<{
  leftId?: string;
  rightId?: string;
}>;

export type CompareOutcome =
  | Readonly<{ kind: "selection" }>
  | Readonly<{ kind: "invalid"; reason: string }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{
      kind: "result";
      left: DocumentSummaryView;
      right: DocumentSummaryView;
      differences: readonly Readonly<{
        kind: "added" | "changed" | "removed";
        heading: string;
        description: string;
      }>[];
    }>;

export const FIXTURE_PROVENANCE = {
  kind: "fixture",
  backendConnected: false,
  label: "Dữ liệu fixture cục bộ — không phải phản hồi API",
} as const;

export function fixtureDocumentId(value: string) {
  return value as DocumentId;
}

export function fixtureSpaceId(value: string) {
  return value as SpaceId;
}
