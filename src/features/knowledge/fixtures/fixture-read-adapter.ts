import "server-only";

import {
  FILE_TYPES,
  PROCESSING_KINDS,
  type CompareOutcome,
  type DocumentDetailView,
  type DocumentListOutcome,
  type DocumentSummaryView,
  type SearchOutcome,
  type SpaceSummaryView,
} from "@/features/knowledge/model";
import type { KnowledgeReadAdapter } from "@/features/knowledge/read-adapter";
import {
  FIXTURE_DOCUMENTS,
  FIXTURE_SPACES,
  type FixtureDocumentRecord,
} from "@/features/knowledge/fixtures/catalog";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .trim();
}

function getSpaceRecord(spaceId: string) {
  return FIXTURE_SPACES.find((space) => space.id === spaceId);
}

function toSpaceSummary(spaceId: string): SpaceSummaryView {
  const space = getSpaceRecord(spaceId);

  if (!space) {
    throw new Error("Fixture catalog contains a document with an unknown space.");
  }

  return {
    ...space,
    documentCount: FIXTURE_DOCUMENTS.filter((document) => document.spaceId === space.id)
      .length,
  };
}

function toDocumentSummary(document: FixtureDocumentRecord): DocumentSummaryView {
  const space = toSpaceSummary(document.spaceId);

  return {
    id: document.id,
    name: document.name,
    fileType: document.fileType,
    versionLabel: document.versionLabel,
    detail: document.detail,
    ownerLabel: document.ownerLabel,
    updatedLabel: document.updatedLabel,
    space: { id: space.id, name: space.name },
    processing: document.processing,
    governance: document.governance,
  };
}

function toDocumentDetail(document: FixtureDocumentRecord): DocumentDetailView {
  const summary = toDocumentSummary(document);

  return {
    ...summary,
    versions: document.versions,
    preview:
      document.processing.kind === "ready"
        ? {
            kind: "fixture-excerpt",
            heading: document.previewHeading,
            locator: document.locator,
            excerpt: document.previewExcerpt,
          }
        : {
            kind: "unavailable",
            reason:
              "Tài liệu fixture chưa ở trạng thái Sẵn sàng; không có preview hay locator được dựng giả.",
          },
  };
}

function validateSpaceAndType(spaceId?: string, fileType?: string) {
  const fields: string[] = [];

  if (spaceId && !getSpaceRecord(spaceId)) fields.push("space");
  if (fileType && !FILE_TYPES.includes(fileType as (typeof FILE_TYPES)[number])) {
    fields.push("type");
  }

  return fields;
}

function matchesQuery(document: FixtureDocumentRecord, query: string) {
  if (!query) return true;
  const haystack = normalizeText(`${document.name} ${document.searchText}`);
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

function matchesScope(document: FixtureDocumentRecord, spaceId?: string, fileType?: string) {
  return (
    (!spaceId || document.spaceId === spaceId) &&
    (!fileType || document.fileType === fileType)
  );
}

const comparePair = ["doc_a91f07", "doc_b40c22"].sort().join(":");

export const fixtureKnowledgeReadAdapter: KnowledgeReadAdapter = {
  async listSpaces() {
    return FIXTURE_SPACES.map((space) => toSpaceSummary(space.id));
  },

  async listDocuments(input): Promise<DocumentListOutcome> {
    const invalidFields = validateSpaceAndType(input.spaceId, input.fileType);
    if (
      input.processing &&
      !PROCESSING_KINDS.includes(input.processing as (typeof PROCESSING_KINDS)[number])
    ) {
      invalidFields.push("status");
    }
    if (invalidFields.length) return { kind: "invalid", fields: invalidFields };

    const documents = FIXTURE_DOCUMENTS.filter(
      (document) =>
        matchesScope(document, input.spaceId, input.fileType) &&
        matchesQuery(document, input.query) &&
        (!input.processing || document.processing.kind === input.processing),
    ).map(toDocumentSummary);

    return documents.length ? { kind: "ready", documents } : { kind: "empty" };
  },

  async search(input): Promise<SearchOutcome> {
    const query = input.query.trim();
    const invalidFields = validateSpaceAndType(input.spaceId, input.fileType);
    if (invalidFields.length) return { kind: "invalid", fields: invalidFields };
    if (!query) return { kind: "initial" };

    const matches = FIXTURE_DOCUMENTS.filter(
      (document) =>
        matchesScope(document, input.spaceId, input.fileType) &&
        matchesQuery(document, query),
    );
    const readyMatches = matches.filter((document) => document.processing.kind === "ready");

    if (readyMatches.length) {
      return {
        kind: "results",
        query,
        results: readyMatches.map((document) => ({
          document: toDocumentSummary(document),
          snippet: document.searchSnippet,
          locator: document.locator,
        })),
      };
    }

    if (matches.length) {
      return {
        kind: "indexing",
        query,
        documents: matches.map(toDocumentSummary),
      };
    }

    return { kind: "empty", query };
  },

  async getDocument(documentId) {
    const document = FIXTURE_DOCUMENTS.find((item) => item.id === documentId);
    return document
      ? { kind: "found", document: toDocumentDetail(document) }
      : {
          kind: "unavailable",
          reason:
            "Không có fixture khả dụng cho liên kết này. Trạng thái này không xác nhận tài nguyên có tồn tại hay người dùng có quyền truy cập.",
        };
  },

  async getSpace(spaceId) {
    const space = getSpaceRecord(spaceId);
    if (!space) {
      return {
        kind: "unavailable",
        reason:
          "Không có fixture không gian khả dụng. Backend folder/space và ACL chưa được kết nối.",
      };
    }

    return {
      kind: "found",
      space: toSpaceSummary(space.id),
      documents: FIXTURE_DOCUMENTS.filter((document) => document.spaceId === space.id).map(
        toDocumentSummary,
      ),
    };
  },

  async compare(input): Promise<CompareOutcome> {
    if (!input.leftId || !input.rightId) return { kind: "selection" };
    if (input.leftId === input.rightId) {
      return { kind: "invalid", reason: "Hãy chọn hai tài liệu fixture khác nhau." };
    }

    const leftRecord = FIXTURE_DOCUMENTS.find((item) => item.id === input.leftId);
    const rightRecord = FIXTURE_DOCUMENTS.find((item) => item.id === input.rightId);
    if (
      !leftRecord ||
      !rightRecord ||
      leftRecord.processing.kind !== "ready" ||
      rightRecord.processing.kind !== "ready"
    ) {
      return {
        kind: "unavailable",
        reason:
          "Cặp tài liệu không có fixture Sẵn sàng. Không có request compare hoặc kiểm tra quyền nào được thực hiện.",
      };
    }

    const pairKey = [leftRecord.id, rightRecord.id].sort().join(":");
    if (pairKey !== comparePair) {
      return {
        kind: "unavailable",
        reason:
          "Chưa có fixture diff cho cặp này; backend compare và hợp đồng async/result chưa được kết nối.",
      };
    }

    return {
      kind: "result",
      left: toDocumentSummary(leftRecord),
      right: toDocumentSummary(rightRecord),
      differences: [
        {
          kind: "added",
          heading: "Khung giờ cộng tác",
          description:
            "Cẩm nang quản lý bổ sung việc thống nhất khung giờ cộng tác cho đội ngũ phân tán.",
        },
        {
          kind: "changed",
          heading: "Cách ghi nhận kết quả",
          description:
            "Tài liệu quản lý mô tả đầu ra mong đợi thay vì chỉ nêu lịch đăng ký theo tuần.",
        },
        {
          kind: "removed",
          heading: "Phạm vi chính sách",
          description:
            "Cẩm nang không thay thế các điều kiện bảo mật và phê duyệt trong quy định làm việc từ xa.",
        },
      ],
    };
  },

  async findDocumentIdByLegacyName(name) {
    return FIXTURE_DOCUMENTS.find((document) => document.name === name)?.id;
  },

  async findSpaceIdByLegacyName(name) {
    return FIXTURE_SPACES.find((space) => space.name === name)?.id;
  },
};
