import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import test from "node:test";

import { FIXTURE_DOCUMENTS, FIXTURE_SPACES } from "../src/features/knowledge/fixtures/catalog.ts";
import { parseUploadedDocumentChunks, extractDocxParagraphs } from "../src/server/ai/document-parser.ts";
import { rankReadyChunksHybrid, retrieveReadyPassagesForChat } from "../src/server/ai/retrieval.ts";
import { UPTECH_BAOGIA_SEED_DOCUMENTS } from "../src/server/knowledge/uptech-baogia-pack.ts";
import {
  buildLegacySafeInsert,
  type StoredKnowledgeDocument,
} from "../src/server/knowledge/repository.ts";
import type { DocumentId, SpaceId } from "../src/features/knowledge/model.ts";

function buildMinimalZipWithDocxXml(xmlContent: string): Buffer {
  const fileNameBuf = Buffer.from("word/document.xml", "utf8");
  const compressed = deflateRawSync(Buffer.from(xmlContent, "utf8"));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(Buffer.byteLength(xmlContent, "utf8"), 22);
  header.writeUInt16LE(fileNameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, fileNameBuf, compressed]);
}

function toStoredDocuments(): StoredKnowledgeDocument[] {
  const spaceMap = new Map(FIXTURE_SPACES.map((s) => [s.id, s]));
  return FIXTURE_DOCUMENTS.map((doc) => {
    const space = spaceMap.get(doc.spaceId)!;
    return {
      summary: {
        id: doc.id as DocumentId,
        name: doc.name,
        fileType: doc.fileType,
        versionLabel: doc.versionLabel,
        detail: doc.detail,
        ownerLabel: doc.ownerLabel,
        updatedLabel: doc.updatedLabel,
        space: { id: space.id as SpaceId, name: space.name },
        processing: doc.processing,
        governance: doc.governance,
      },
      versions: doc.versions,
      isUserUploaded: false,
      byteSize: 0,
      chunks:
        doc.processing.kind === "ready"
          ? [
              {
                chunkId: `${doc.id}-chunk-0`,
                documentId: doc.id,
                chunkIndex: 0,
                heading: doc.previewHeading,
                locator: doc.locator,
                content: doc.previewExcerpt,
              },
            ]
          : [],
    };
  });
}

test("parseUploadedDocumentChunks extracts markdown sections cleanly", async () => {
  const markdown = [
    "# Chính sách bảo mật",
    "Mọi dữ liệu nội bộ phải được mã hóa khi lưu trữ.",
    "",
    "# Quy trình phản hồi sự cố",
    "Báo cáo ngay cho đội ngũ An toàn thông tin trong vòng 30 phút.",
  ].join("\n");

  const chunks = await parseUploadedDocumentChunks({
    fileName: "policy.md",
    extension: "md",
    bytes: new TextEncoder().encode(markdown),
    locale: "vi",
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.heading, "Chính sách bảo mật");
  assert.match(chunks[1]?.content ?? "", /30 phút/);
});

test("extractDocxParagraphs inflates word/document.xml and decodes XML entities", () => {
  const xml =
    '<w:document><w:body><w:p><w:r><w:t>Quy &amp; trình làm việc</w:t></w:r></w:p><w:p><w:r><w:t>Thử nghiệm DOCX thành công</w:t></w:r></w:p></w:body></w:document>';
  const docxBuffer = buildMinimalZipWithDocxXml(xml);
  const paragraphs = extractDocxParagraphs(docxBuffer);

  assert.deepEqual(paragraphs, [
    "Quy & trình làm việc",
    "Thử nghiệm DOCX thành công",
  ]);
});

test("retrieveReadyPassagesForChat enforces Ready-Only and isolates OCR-only scopes", async () => {
  const docs = toStoredDocuments();

  const opsOutcome = await retrieveReadyPassagesForChat({
    prompt: "Vận hành nội bộ",
    scope: "space:operations",
    selectedDocumentIds: [],
    documents: docs,
  });
  assert.equal(opsOutcome.evidenceState, "empty");
  assert.equal(opsOutcome.excludedCount, 1);
  assert.equal(opsOutcome.passages.length, 0);

  const hrOutcome = await retrieveReadyPassagesForChat({
    prompt: "Quy định làm việc từ xa bảo mật",
    scope: "space:hr",
    selectedDocumentIds: [],
    documents: docs,
  });
  assert.equal(hrOutcome.evidenceState, "grounded");
  assert.equal(hrOutcome.excludedCount, 2);
  assert.ok(hrOutcome.citations.length >= 1);
  assert.equal(hrOutcome.citations[0]?.id, "doc_a91f07");
});

test("Document library screens use live APIs with zero fake fixture labels or invisible light-mode text", () => {
  const libSource = readFileSync("src/features/documents/DocumentLibraryScreen.tsx", "utf8");
  const pickerSource = readFileSync("src/components/workspace/DocumentFilePicker.tsx", "utf8");
  const routesSource = readFileSync("src/features/documents/DocumentRouteScreens.tsx", "utf8");
  const actionsSource = readFileSync("src/features/documents/DocumentLibraryActions.tsx", "utf8");

  assert.equal(libSource.includes("DemoNotice"), false);
  assert.equal(libSource.includes("text-white"), false);
  assert.equal(libSource.toLowerCase().includes("fixture"), false);
  assert.ok(pickerSource.includes("/api/v1/workspace/documents"));
  assert.ok(actionsSource.includes("/api/v1/workspace/spaces"));
  assert.ok(actionsSource.includes("/download"));
  assert.equal(routesSource.includes("chưa kết nối"), false);
});

test("rankReadyChunksHybrid ranks relevant Ready chunks and SearchScreen removes fake/dark UI", async () => {
  const docs = toStoredDocuments();
  const ranked = await rankReadyChunksHybrid({
    query: "bao mat thong tin lam viec tu xa",
    documents: docs,
  });

  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0]?.document.summary.id, "doc_a91f07");
  assert.equal(ranked[0]?.document.summary.processing.kind, "ready");

  const searchSource = readFileSync("src/features/search/SearchScreen.tsx", "utf8");
  const summarySource = readFileSync("src/features/search/SearchAiSummaryCard.tsx", "utf8");
  assert.equal(searchSource.includes("DemoNotice"), false);
  assert.equal(searchSource.includes("bg-slate-900"), false);
  assert.equal(searchSource.toLowerCase().includes("fixture"), false);
  assert.ok(summarySource.includes("/api/v1/workspace/search"));

  const knowledgeSource = readFileSync("src/features/knowledge/KnowledgeCardsWorkbench.tsx", "utf8");
  const knowledgePageSource = readFileSync("src/app/(workspace)/knowledge/page.tsx", "utf8");
  assert.equal(knowledgePageSource.includes("KnowledgeContractGapScreen"), false);
  assert.ok(knowledgeSource.includes("/api/v1/workspace/knowledge"));
  assert.equal(knowledgeSource.toLowerCase().includes("fixture"), false);
});

test("Utility, Notifications, and Dashboard remove all fake fixture/DemoNotice strings and wire real APIs", () => {
  const utilitySource = readFileSync("src/components/workspace/UtilityWorkbench.tsx", "utf8");
  const utilityPage = readFileSync("src/app/(workspace)/utility/page.tsx", "utf8");
  const utilityConfig = readFileSync("src/components/workspace/UtilitySourceConfigurator.tsx", "utf8");
  const notifSource = readFileSync("src/components/workspace/NotificationCenterPrototype.tsx", "utf8");
  const notifPage = readFileSync("src/app/(workspace)/notifications/page.tsx", "utf8");
  const dashSource = readFileSync("src/features/dashboard/DashboardScreen.tsx", "utf8");
  const proxySource = readFileSync("src/proxy.ts", "utf8");

  for (const src of [utilitySource, utilityPage, utilityConfig, notifSource, notifPage, dashSource]) {
    assert.equal(src.includes("DemoNotice"), false);
    assert.equal(src.toLowerCase().includes("fixture"), false);
  }
  assert.equal(notifSource.includes("doc_a91f07"), false);
  assert.equal(dashSource.includes("doc_a91f07"), false);
  assert.equal(utilitySource.includes("/api/v1/workspace/utility"), true);
  assert.equal(notifSource.includes("/api/v1/workspace/notifications"), true);
  assert.equal(proxySource.includes("/api/v1/workspace/utility"), true);
  assert.equal(proxySource.includes("/api/v1/workspace/notifications"), true);
});

test("UPTECH knowledge pack indexes ready chunks and distinguishes general greetings from UPTECH queries", async () => {
  assert.equal(UPTECH_BAOGIA_SEED_DOCUMENTS.length, 5);
  for (const doc of UPTECH_BAOGIA_SEED_DOCUMENTS) {
    assert.equal(doc.summary.processing.kind, "ready");
    assert.ok(doc.summary.id.startsWith("kb_uptech_"));
    assert.ok(doc.chunks.length >= 3);
  }

  const greetingOutcome = await retrieveReadyPassagesForChat({
    prompt: "hi",
    scope: "workspace",
    selectedDocumentIds: [],
    documents: UPTECH_BAOGIA_SEED_DOCUMENTS,
  });
  assert.equal(greetingOutcome.hasRelevantMatch, false);

  const uptechPriceOutcome = await retrieveReadyPassagesForChat({
    prompt: "giá thiết kế logo gói phát triển bao nhiêu?",
    scope: "workspace",
    selectedDocumentIds: [],
    documents: UPTECH_BAOGIA_SEED_DOCUMENTS,
  });
  assert.equal(uptechPriceOutcome.hasRelevantMatch, true);
  assert.equal(uptechPriceOutcome.evidenceState, "grounded");
  assert.ok(uptechPriceOutcome.citations.length >= 1);
  assert.match(uptechPriceOutcome.passages[0]?.chunk.content ?? "", /28\.900\.000đ/);
});

test("buildLegacySafeInsert populates checksum even when table column has default + check constraint", () => {
  const inserted = buildLegacySafeInsert({
    tableName: "knowledge_documents",
    baseColumns: ["workspace_id", "id", "name"],
    baseValues: ["00000000-0000-4000-8000-000000000001", "doc_test_1", "Test.docx"],
    requiredColumns: [
      {
        columnName: "checksum",
        udtName: "text",
        isRequiredNoDefault: false,
        hasCheckConstraint: true,
        requiresSha256Prefix: true,
      },
      {
        columnName: "optional_note",
        udtName: "text",
        isRequiredNoDefault: false,
        hasCheckConstraint: false,
      },
    ],
    access: {
      mode: "authenticated",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      membershipId: "00000000-0000-4000-8000-000000000002",
      actorLabel: "user-1",
      workspaceRole: "OWNER",
      departmentKey: null,
    },
    contextDefaults: {
      checksum: "abcdef1234567890",
    },
  });

  assert.match(inserted.sql, /"checksum"/);
  assert.equal(inserted.sql.includes("optional_note"), false);
  assert.ok(inserted.values.includes("sha256:abcdef1234567890"));
});
