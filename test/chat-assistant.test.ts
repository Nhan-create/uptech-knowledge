import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FIXTURE_DOCUMENTS,
  FIXTURE_SPACES,
} from "../src/features/knowledge/fixtures/catalog.ts";
import type {
  DocumentDetailView,
  DocumentSummaryView,
  SpaceSummaryView,
} from "../src/features/knowledge/model.ts";
import {
  buildChatTurnResponse,
  CHAT_STARTER_PROMPTS,
  formatChatTurnForCopy,
} from "../src/features/chat/chat-engine.ts";
import {
  deleteChatSession,
  getChatSessionsServerSnapshot,
  getChatSessionsSnapshot,
  saveChatSessions,
  upsertChatSession,
} from "../src/features/chat/chat-sessions.ts";
import {
  buildLocalDocumentFromFile,
  MAX_LOCAL_FILE_BYTES,
  validateLocalUploadFile,
} from "../src/features/chat/local-file-ingest.ts";

function buildChatFixtureData(): {
  spaces: SpaceSummaryView[];
  documents: DocumentSummaryView[];
  readyDetails: DocumentDetailView[];
} {
  const spaceMap = new Map(FIXTURE_SPACES.map((space) => [space.id, space]));
  const spaces: SpaceSummaryView[] = FIXTURE_SPACES.map((space) => ({
    ...space,
    documentCount: FIXTURE_DOCUMENTS.filter((doc) => doc.spaceId === space.id).length,
  }));

  const documents: DocumentSummaryView[] = FIXTURE_DOCUMENTS.map((doc) => {
    const space = spaceMap.get(doc.spaceId);
    if (!space) throw new Error(`Missing space ${doc.spaceId}`);
    return {
      id: doc.id,
      name: doc.name,
      fileType: doc.fileType,
      versionLabel: doc.versionLabel,
      detail: doc.detail,
      ownerLabel: doc.ownerLabel,
      updatedLabel: doc.updatedLabel,
      space: { id: space.id, name: space.name },
      processing: doc.processing,
      governance: doc.governance,
    };
  });

  const readyDetails: DocumentDetailView[] = FIXTURE_DOCUMENTS.filter(
    (doc) => doc.processing.kind === "ready",
  ).map((doc, idx) => ({
    ...documents[FIXTURE_DOCUMENTS.findIndex((item) => item.id === doc.id)]!,
    versions: doc.versions,
    preview: {
      kind: "fixture-excerpt",
      heading: doc.previewHeading,
      locator: doc.locator,
      excerpt: doc.previewExcerpt || `Excerpt ${idx + 1}`,
    },
  }));

  return { spaces, documents, readyDetails };
}

test("buildChatTurnResponse cites only Ready documents with real locators and excerpts", () => {
  const { spaces, documents, readyDetails } = buildChatFixtureData();

  const hrTurn = buildChatTurnResponse({
    id: "turn-1",
    prompt: "Quy định làm việc từ xa 2026 và nghĩa vụ bảo mật",
    scope: "space:hr",
    documents,
    readyDetails,
    spaces,
    locale: "vi",
  });

  assert.equal(hrTurn.evidenceState, "grounded");
  assert.ok(hrTurn.citations.length >= 1);
  assert.equal(hrTurn.citations[0]?.id, "doc_a91f07");
  assert.equal(hrTurn.citations[0]?.location, "Trang mẫu 4");
  assert.ok(hrTurn.citations[0]?.quote.includes("bảo mật thông tin"));
  assert.equal(hrTurn.excludedProcessingCount, 2);

  for (const starter of CHAT_STARTER_PROMPTS) {
    for (const locale of ["vi", "en"] as const) {
      const turn = buildChatTurnResponse({
        id: `starter-${starter.id}-${locale}`,
        prompt: starter[locale],
        scope: starter.scope,
        documents,
        readyDetails,
        spaces,
        locale,
      });
      assert.ok(
        turn.citations.length >= 1,
        `Starter ${starter.id} (${locale}) should return Ready citations`,
      );
      assert.notEqual(turn.evidenceState, "empty");
    }
  }
});

test("buildChatTurnResponse returns empty evidence for Operations OCR-only scope and caution for Deprecated Atlas", () => {
  const { spaces, documents, readyDetails } = buildChatFixtureData();

  const opsTurn = buildChatTurnResponse({
    id: "turn-ops",
    prompt: "Quy trình vận hành nội bộ",
    scope: "space:operations",
    documents,
    readyDetails,
    spaces,
    locale: "vi",
  });
  assert.equal(opsTurn.evidenceState, "empty");
  assert.equal(opsTurn.citations.length, 0);
  assert.equal(opsTurn.points.length, 0);
  assert.equal(opsTurn.excludedProcessingCount, 1);

  const atlasTurn = buildChatTurnResponse({
    id: "turn-atlas",
    prompt: "Cách ghi nhận đầu việc sau bàn giao dự án",
    scope: "space:atlas",
    documents,
    readyDetails,
    spaces,
    locale: "vi",
  });
  assert.equal(atlasTurn.evidenceState, "caution");
  assert.equal(atlasTurn.citations[0]?.id, "doc_19de58");
  assert.equal(atlasTurn.citations[0]?.isDeprecated, true);
  assert.equal(atlasTurn.excludedProcessingCount, 3);
});

test("buildChatTurnResponse respects selected-documents scope and formats plain-text copy cleanly", () => {
  const { spaces, documents, readyDetails } = buildChatFixtureData();

  const pinnedTurn = buildChatTurnResponse({
    id: "turn-pinned",
    prompt: "Tóm tắt nội dung chính",
    scope: "selected-documents",
    selectedDocumentIds: ["doc_b40c22"],
    documents,
    readyDetails,
    spaces,
    locale: "vi",
  });

  assert.equal(pinnedTurn.citations.length, 1);
  assert.equal(pinnedTurn.citations[0]?.id, "doc_b40c22");
  assert.equal(pinnedTurn.citations[0]?.heading, "Phối hợp đội nhóm phân tán");

  const copied = formatChatTurnForCopy(pinnedTurn, "vi");
  assert.ok(copied.includes("Cẩm nang quản lý đội nhóm.docx"));
  assert.ok(copied.includes("Mục mẫu 2.3"));
  assert.equal(copied.includes("[PROPOSED UI]"), false);
});

test("ChatDemo and /chat/page remove prototype spec jargon and support dynamic turns", () => {
  const chatSource = readFileSync("src/components/workspace/ChatDemo.tsx", "utf8");
  const pageSource = readFileSync("src/app/(workspace)/chat/page.tsx", "utf8");

  assert.equal(chatSource.includes("[PROPOSED UI]"), false);
  assert.equal(chatSource.includes("[SHARED CONTRACT GAP]"), false);
  assert.equal(pageSource.includes("StatePreview"), false);
  assert.ok(chatSource.includes("buildChatTurnResponse"));
  assert.ok(chatSource.includes("navigator.clipboard"));
  assert.equal(chatSource.includes("calc(100dvh"), false);

  const appShellSource = readFileSync("src/components/app-shell/AppShell.tsx", "utf8");
  assert.ok(appShellSource.includes("uptech-glean-shell--chat"));
});

test("chat session store supports upserting, deleting, and SSR server snapshot", () => {
  assert.deepEqual(getChatSessionsServerSnapshot(), []);

  const storageMap = new Map<string, string>();
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, val: string) => {
        storageMap.set(key, val);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  try {
    saveChatSessions([]);
    assert.equal(getChatSessionsSnapshot().length, 0);

    upsertChatSession({
      id: "sess-1",
      title: "Quy định từ xa",
      scope: "space:hr",
      turns: [],
    });
    upsertChatSession({
      id: "sess-2",
      title: "Bàn giao Atlas",
      scope: "space:atlas",
      turns: [],
    });

    const current = getChatSessionsSnapshot();
    assert.equal(current.length, 2);
    assert.equal(current[0]?.id, "sess-2");

    deleteChatSession("sess-2");
    assert.equal(getChatSessionsSnapshot().length, 1);
    assert.equal(getChatSessionsSnapshot()[0]?.id, "sess-1");
    saveChatSessions([]);
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

test("validateLocalUploadFile allows supported types under 10 MB and rejects bad files", () => {
  assert.equal(validateLocalUploadFile("huong-dan.md", 1024), null);
  assert.equal(validateLocalUploadFile("bao-cao.pdf", MAX_LOCAL_FILE_BYTES), null);
  assert.equal(validateLocalUploadFile("malware.exe", 512), "unsupported_type");
  assert.equal(
    validateLocalUploadFile("oversized.pdf", MAX_LOCAL_FILE_BYTES + 1),
    "file_too_large",
  );
});

test("buildLocalDocumentFromFile integrates with buildChatTurnResponse using localTextById", () => {
  const { spaces, documents, readyDetails } = buildChatFixtureData();
  const uploaded = buildLocalDocumentFromFile({
    id: "local-test-policy",
    name: "quy-trinh-nghi-phep.md",
    sizeBytes: 2400,
    textContent: [
      "Giới thiệu chung về văn hóa đội ngũ.",
      "",
      "Nhân sự gửi đơn nghỉ phép trước tối thiểu 3 ngày làm việc qua cổng nội bộ và thông báo cho quản lý trực tiếp.",
    ].join("\n"),
    locale: "vi",
  });

  const turn = buildChatTurnResponse({
    id: "turn-local",
    prompt: "Nghỉ phép cần gửi đơn trước mấy ngày?",
    scope: "selected-documents",
    selectedDocumentIds: [uploaded.summary.id],
    documents: [uploaded.summary, ...documents],
    readyDetails: [uploaded.detail, ...readyDetails],
    localTextById: { [uploaded.summary.id]: uploaded.rawText ?? "" },
    spaces,
    locale: "vi",
  });

  assert.equal(turn.evidenceState, "grounded");
  assert.equal(turn.citations.length, 1);
  assert.equal(turn.citations[0]?.id, "local-test-policy");
  assert.equal(turn.citations[0]?.isLocalUpload, true);
  assert.match(turn.citations[0]?.quote ?? "", /tối thiểu 3 ngày làm việc/);
});

test("ChatDemo supports device file upload and composer suppresses double inner focus outline", () => {
  const chatSource = readFileSync("src/components/workspace/ChatDemo.tsx", "utf8");
  const cssSource = readFileSync("src/styles/workspace-glean.css", "utf8");

  assert.match(chatSource, /id="chat-device-upload-input"/);
  assert.match(chatSource, /className="chat-composer-textarea /);
  assert.match(cssSource, /\.chat-composer-textarea:focus-visible\s*\{\s*outline:\s*none;/);
});
