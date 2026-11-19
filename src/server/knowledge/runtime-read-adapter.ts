import { headers } from "next/headers";
import { normalizeFold } from "@/features/dashboard/hero-matching";
import {
  FILE_TYPES,
  PROCESSING_KINDS,
  type CompareInput,
  type CompareOutcome,
  type DocumentDetailView,
  type DocumentListInput,
  type DocumentListOutcome,
  type DocumentLookupOutcome,
  type SearchInput,
  type SearchOutcome,
  type SearchResultView,
  type SpaceLookupOutcome,
  type SpaceSummaryView,
} from "@/features/knowledge/model";
import type { KnowledgeReadAdapter } from "@/features/knowledge/read-adapter";
import { compareDocumentsWithGemini } from "@/server/ai/gemini-client";
import { rankReadyChunksHybrid } from "@/server/ai/retrieval";
import {
  getPreviewWorkspaceContext,
  isWorkspacePreviewModeEnabled,
  resolveWorkspaceServerAccess,
  type WorkspaceAccessContext,
} from "@/server/knowledge/access-context";
import {
  getDocumentVersionChunks,
  loadKnowledgeDocumentsAndSpaces,
  type StoredKnowledgeDocument,
} from "@/server/knowledge/repository";

function toDetailView(record: StoredKnowledgeDocument): DocumentDetailView {
  const firstChunk = record.chunks[0];
  return {
    ...record.summary,
    versions: record.versions,
    sections: record.chunks.map((chunk) => ({
      id: chunk.chunkId,
      heading: chunk.heading,
      locator: chunk.locator,
      content: chunk.content,
    })),
    preview:
      record.summary.processing.kind === "ready" && firstChunk
        ? {
            kind: "fixture-excerpt",
            heading: firstChunk.heading,
            locator: firstChunk.locator,
            excerpt: firstChunk.content,
          }
        : {
            kind: "unavailable",
            reason:
              "Tài liệu chưa ở trạng thái Sẵn sàng; không có preview hay locator khả dụng.",
          },
  };
}

function computeStructuralDiff(
  left: StoredKnowledgeDocument,
  right: StoredKnowledgeDocument,
) {
  const leftMap = new Map(
    left.chunks.map((chunk) => [normalizeFold(chunk.heading) || chunk.locator, chunk]),
  );
  const rightMap = new Map(
    right.chunks.map((chunk) => [normalizeFold(chunk.heading) || chunk.locator, chunk]),
  );
  const differences: Array<{
    kind: "added" | "changed" | "removed";
    heading: string;
    description: string;
  }> = [];

  for (const [key, rChunk] of rightMap.entries()) {
    const lChunk = leftMap.get(key);
    if (!lChunk) {
      differences.push({
        kind: "added",
        heading: rChunk.heading,
        description: `Có trong "${right.summary.name}" (${rChunk.locator}): ${rChunk.content.slice(0, 220)}`,
      });
    } else if (normalizeFold(lChunk.content) !== normalizeFold(rChunk.content)) {
      differences.push({
        kind: "changed",
        heading: rChunk.heading,
        description: `Nội dung thay đổi từ "${lChunk.content.slice(0, 120)}" sang "${rChunk.content.slice(0, 140)}".`,
      });
    }
  }

  for (const [key, lChunk] of leftMap.entries()) {
    if (!rightMap.has(key)) {
      differences.push({
        kind: "removed",
        heading: lChunk.heading,
        description: `Chỉ có ở "${left.summary.name}" (${lChunk.locator}): ${lChunk.content.slice(0, 220)}`,
      });
    }
  }

  return differences;
}

async function resolveCurrentAccess(
  explicitAccess?: WorkspaceAccessContext | null,
): Promise<WorkspaceAccessContext | null> {
  if (explicitAccess) return explicitAccess;
  try {
    const incomingHeaders = await headers();
    return await resolveWorkspaceServerAccess(new Headers(incomingHeaders));
  } catch {
    return isWorkspacePreviewModeEnabled() ? getPreviewWorkspaceContext() : null;
  }
}

async function loadStateSafe(explicitAccess?: WorkspaceAccessContext | null) {
  const access = await resolveCurrentAccess(explicitAccess);
  if (!access) {
    return null;
  }
  try {
    return await loadKnowledgeDocumentsAndSpaces(access);
  } catch {
    return null;
  }
}

export function createKnowledgeReadAdapterForAccess(
  explicitAccess?: WorkspaceAccessContext | null,
): KnowledgeReadAdapter {
  const load = () => loadStateSafe(explicitAccess);
  return {
    async listSpaces(): Promise<readonly SpaceSummaryView[]> {
      const state = await load();
      return state ? state.spaces : [];
    },

    async listDocuments(input: DocumentListInput): Promise<DocumentListOutcome> {
      const state = await load();
      if (!state) return { kind: "empty" };

      const fields: string[] = [];
      if (input.spaceId && !state.spaces.some((s) => s.id === input.spaceId)) {
        fields.push("space");
      }
      if (
        input.processing &&
        !PROCESSING_KINDS.includes(input.processing as (typeof PROCESSING_KINDS)[number])
      ) {
        fields.push("status");
      }
      if (
        input.fileType &&
        !FILE_TYPES.includes(input.fileType as (typeof FILE_TYPES)[number])
      ) {
        fields.push("type");
      }
      if (fields.length > 0) {
        return { kind: "invalid", fields };
      }

      const normalizedQuery = normalizeFold(input.query ?? "");
      const documents = state.documents
        .map((item) => item.summary)
        .filter((doc) => !input.spaceId || doc.space.id === input.spaceId)
        .filter((doc) => !input.processing || doc.processing.kind === input.processing)
        .filter((doc) => !input.fileType || doc.fileType === input.fileType)
        .filter((doc) => {
          if (!normalizedQuery) return true;
          return normalizeFold(
            `${doc.name} ${doc.detail} ${doc.ownerLabel} ${doc.space.name}`,
          ).includes(normalizedQuery);
        });

      return documents.length > 0 ? { kind: "ready", documents } : { kind: "empty" };
    },

    async search(input: SearchInput): Promise<SearchOutcome> {
      const state = await load();
      if (!state) return { kind: "initial" };

      const fields: string[] = [];
      if (input.spaceId && !state.spaces.some((s) => s.id === input.spaceId)) {
        fields.push("space");
      }
      if (
        input.fileType &&
        !FILE_TYPES.includes(input.fileType as (typeof FILE_TYPES)[number])
      ) {
        fields.push("type");
      }
      if (fields.length > 0) {
        return { kind: "invalid", fields };
      }

      const query = input.query.trim();
      const foldedQuery = normalizeFold(query);
      if (!foldedQuery) {
        return { kind: "initial" };
      }

      const scopedDocs = state.documents.filter(
        (record) =>
          (!input.spaceId || record.summary.space.id === input.spaceId) &&
          (!input.fileType || record.summary.fileType === input.fileType),
      );

      const rankedMatches = await rankReadyChunksHybrid({
        query,
        documents: scopedDocs,
      });

      const readyMatches: SearchResultView[] = [];
      const seenDocIds = new Set<string>();

      for (const match of rankedMatches) {
        if (seenDocIds.has(match.document.summary.id)) continue;
        seenDocIds.add(match.document.summary.id);
        readyMatches.push({
          document: match.document.summary,
          chunkId: match.chunk.chunkId,
          snippet: match.chunk.content.slice(0, 320),
          locator: match.chunk.locator,
          heading: match.chunk.heading,
          score: Math.round(match.score * 10) / 10,
        });
      }

      for (const record of scopedDocs) {
        if (record.summary.processing.kind !== "ready") continue;
        if (seenDocIds.has(record.summary.id)) continue;
        const metaHit = normalizeFold(
          `${record.summary.name} ${record.summary.detail} ${record.summary.space.name}`,
        ).includes(foldedQuery);
        if (metaHit) {
          const snippetSource = record.chunks[0];
          readyMatches.push({
            document: record.summary,
            chunkId: snippetSource?.chunkId,
            snippet: snippetSource?.content.slice(0, 320) ?? record.summary.detail,
            locator: snippetSource?.locator ?? record.summary.versionLabel,
            heading: snippetSource?.heading,
            score: 5,
          });
        }
      }

      if (readyMatches.length > 0) {
        return { kind: "results", query, results: readyMatches };
      }

      const processingMatches = scopedDocs
        .filter((record) => record.summary.processing.kind !== "ready")
        .filter((record) =>
          normalizeFold(
            `${record.summary.name} ${record.summary.detail} ${record.summary.processing.label}`,
          ).includes(foldedQuery),
        )
        .map((record) => record.summary);

      if (processingMatches.length > 0) {
        return { kind: "indexing", query, documents: processingMatches };
      }

      return { kind: "empty", query };
    },

    async getDocument(documentId: string): Promise<DocumentLookupOutcome> {
      const state = await load();
      if (!state) {
        return {
          kind: "unavailable",
          reason: "Kho tri thức chưa sẵn sàng để tra cứu tài liệu.",
        };
      }

      const record = state.documents.find((item) => item.summary.id === documentId);
      if (!record) {
        return {
          kind: "unavailable",
          reason: "Tài liệu không tồn tại hoặc không thuộc phạm vi quyền truy cập hiện tại.",
        };
      }
      return { kind: "found", document: toDetailView(record) };
    },

    async getSpace(spaceId: string): Promise<SpaceLookupOutcome> {
      const state = await load();
      if (!state) {
        return {
          kind: "unavailable",
          reason: "Kho tri thức chưa sẵn sàng để mở không gian.",
        };
      }

      const space = state.spaces.find((item) => item.id === spaceId);
      if (!space) {
        return {
          kind: "unavailable",
          reason: "Không gian tri thức không tồn tại hoặc bạn chưa có quyền truy cập.",
        };
      }
      const documents = state.documents
        .map((item) => item.summary)
        .filter((doc) => doc.space.id === spaceId);
      return { kind: "found", space, documents };
    },

    async compare(input: CompareInput): Promise<CompareOutcome> {
      const state = await load();
      if (!state) {
        return {
          kind: "unavailable",
          reason: "Kho tri thức chưa khả dụng hoặc chưa có phiên làm việc hợp lệ.",
        };
      }

      if (!input.leftId && !input.rightId) {
        return { kind: "selection" };
      }
      if (!input.leftId || !input.rightId) {
        return {
          kind: "invalid",
          reason: "Cần chọn đủ cả hai tài liệu Sẵn sàng để thực hiện so sánh.",
        };
      }

      const [leftBaseId, leftExplicitVersion] = input.leftId.split("::");
      const [rightBaseId, rightExplicitVersion] = input.rightId.split("::");

      const leftDoc = state.documents.find((d) => d.summary.id === leftBaseId);
      const rightDoc = state.documents.find((d) => d.summary.id === rightBaseId);
      if (!leftDoc || !rightDoc) {
        return {
          kind: "unavailable",
          reason: "Không tìm thấy một trong hai tài liệu được chọn trong thư viện.",
        };
      }

      if (
        leftBaseId === rightBaseId &&
        !leftExplicitVersion &&
        !rightExplicitVersion &&
        leftDoc.versions.length < 2
      ) {
        return {
          kind: "invalid",
          reason:
            "Tài liệu này hiện chỉ có 1 phiên bản (v1.0). Hãy tải lên phiên bản mới (v2.0) trong trang chi tiết tài liệu hoặc chọn hai tài liệu khác nhau để đối chiếu.",
        };
      }
      if (
        leftDoc.summary.processing.kind !== "ready" ||
        rightDoc.summary.processing.kind !== "ready"
      ) {
        return {
          kind: "invalid",
          reason: "Chỉ có thể so sánh các tài liệu đã hoàn tất lập chỉ mục Sẵn sàng.",
        };
      }

      const access = await resolveCurrentAccess(explicitAccess);
      const autoSameDoc =
        leftBaseId === rightBaseId && !leftExplicitVersion && !rightExplicitVersion;
      const effectiveLeftVer =
        leftExplicitVersion ??
        (autoSameDoc ? leftDoc.versions[1]?.id : leftDoc.versions[0]?.id);
      const effectiveRightVer =
        rightExplicitVersion ?? leftDoc.versions[0]?.id;

      const leftChunks =
        access && effectiveLeftVer
          ? await getDocumentVersionChunks(access, leftDoc.summary.id, effectiveLeftVer)
          : leftDoc.chunks;
      const rightChunks =
        access && (rightExplicitVersion || autoSameDoc) && effectiveRightVer
          ? await getDocumentVersionChunks(access, rightDoc.summary.id, effectiveRightVer)
          : rightDoc.chunks;

      const leftVerLabel =
        leftDoc.versions.find(
          (v) => v.id === effectiveLeftVer || v.label === effectiveLeftVer,
        )?.label ?? leftDoc.summary.versionLabel;
      const rightVerLabel =
        rightDoc.versions.find(
          (v) => v.id === effectiveRightVer || v.label === effectiveRightVer,
        )?.label ?? rightDoc.summary.versionLabel;

      const left: StoredKnowledgeDocument = {
        ...leftDoc,
        summary: {
          ...leftDoc.summary,
          versionLabel: leftVerLabel,
        },
        chunks: leftChunks,
      };
      const right: StoredKnowledgeDocument = {
        ...rightDoc,
        summary: {
          ...rightDoc.summary,
          versionLabel: rightVerLabel,
        },
        chunks: rightChunks,
      };

      const leftText = left.chunks
        .map((c) => `[${c.locator} - ${c.heading}]\n${c.content}`)
        .join("\n\n");
      const rightText = right.chunks
        .map((c) => `[${c.locator} - ${c.heading}]\n${c.content}`)
        .join("\n\n");

      const aiDifferences = await compareDocumentsWithGemini({
        leftTitle: left.summary.name,
        leftContent: leftText,
        rightTitle: right.summary.name,
        rightContent: rightText,
        locale: "vi",
      });

      const differences =
        aiDifferences && aiDifferences.length > 0
          ? aiDifferences
          : computeStructuralDiff(left, right);

      if (differences.length === 0) {
        return {
          kind: "result",
          left: left.summary,
          right: right.summary,
          differences: [
            {
              kind: "changed",
              heading: "Nội dung tương đồng",
              description:
                "Hai tài liệu không có khác biệt đáng kể giữa các đoạn đã lập chỉ mục.",
            },
          ],
        };
      }

      return {
        kind: "result",
        left: left.summary,
        right: right.summary,
        differences,
      };
    },

    async findDocumentIdByLegacyName(name: string): Promise<string | undefined> {
      const state = await load();
      const folded = normalizeFold(name);
      return state?.documents.find((d) => normalizeFold(d.summary.name) === folded)?.summary.id;
    },

    async findSpaceIdByLegacyName(name: string): Promise<string | undefined> {
      const state = await load();
      const folded = normalizeFold(name);
      return state?.spaces.find((s) => normalizeFold(s.name) === folded)?.id;
    },
  };
}

export const runtimeKnowledgeReadAdapter: KnowledgeReadAdapter =
  createKnowledgeReadAdapterForAccess();
