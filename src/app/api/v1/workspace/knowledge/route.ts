import { randomUUID } from "node:crypto";

import {
  extractKnowledgeCardsWithGemini,
  readGeminiConfig,
} from "@/server/ai/gemini-client";
import {
  createKnowledgeCards,
  listKnowledgeCards,
  loadKnowledgeDocumentsAndSpaces,
  type KnowledgeCardKind,
  type KnowledgeCardRecord,
} from "@/server/knowledge/repository";
import type { Locale } from "@/lib/preferences";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<KnowledgeCardKind>([
  "decision",
  "open-question",
  "rule",
]);

function formatToday(locale: Locale): string {
  return new Date().toLocaleDateString(locale === "en" ? "en-US" : "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const cards = await listKnowledgeCards(auth.access);
  return workspaceJson({ ok: true, cards }, 200, requestId);
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    mode?: unknown;
    documentId?: unknown;
    sourceDocumentId?: unknown;
    kind?: unknown;
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
    spaceId?: unknown;
    locale?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const locale: Locale = body.locale === "en" ? "en" : "vi";
  const mode = body.mode === "extract" ? "extract" : "manual";
  const { spaces, documents } = await loadKnowledgeDocumentsAndSpaces(auth.access);

  if (mode === "extract") {
    const documentId =
      typeof body.documentId === "string" ? body.documentId.trim() : "";
    const targetDoc = documents.find((d) => d.summary.id === documentId);
    if (!targetDoc) {
      return workspaceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "Không tìm thấy tài liệu để rút trích Thẻ tri thức.",
        requestId,
      );
    }
    if (
      targetDoc.summary.processing.kind !== "ready" ||
      targetDoc.chunks.length === 0
    ) {
      return workspaceError(
        400,
        "DOCUMENT_NOT_READY",
        "Tài liệu chưa ở trạng thái Sẵn sàng hoặc chưa có nội dung.",
        requestId,
      );
    }
    if (!readGeminiConfig()) {
      return workspaceError(
        503,
        "AI_NOT_CONFIGURED",
        "Chưa cấu hình Gemini API key trên máy chủ.",
        requestId,
      );
    }

    const fullContent = targetDoc.chunks
      .map((c) => `[${c.locator} · ${c.heading}]\n${c.content}`)
      .join("\n\n");

    const drafts = await extractKnowledgeCardsWithGemini({
      documentTitle: targetDoc.summary.name,
      content: fullContent,
      locale,
    });

    if (!drafts || drafts.length === 0) {
      return workspaceError(
        502,
        "AI_EXTRACTION_FAILED",
        "Hệ thống AI chưa thể rút trích thẻ từ tài liệu này. Vui lòng thử lại.",
        requestId,
      );
    }

    const nowLabel = formatToday(locale);
    const created: KnowledgeCardRecord[] = drafts.map((draft) => ({
      id: `card-${randomUUID().slice(0, 12)}`,
      kind: draft.kind,
      status: "draft",
      title: draft.title,
      summary: draft.summary,
      rationale: draft.rationale,
      spaceId: targetDoc.summary.space.id,
      spaceName: targetDoc.summary.space.name,
      sourceDocumentId: targetDoc.summary.id,
      sourceDocumentName: targetDoc.summary.name,
      sourceLocator:
        draft.sourceLocator || targetDoc.chunks[0]?.locator || targetDoc.summary.versionLabel,
      ownerLabel: `${auth.access.actorLabel} · AI`,
      updatedLabel: nowLabel,
      version: 1,
    }));

    const persisted = await createKnowledgeCards(auth.access, created);
    return workspaceJson({ ok: true, cards: persisted }, 201, requestId);
  }

  // Manual creation
  const kind: KnowledgeCardKind =
    typeof body.kind === "string" && VALID_KINDS.has(body.kind as KnowledgeCardKind)
      ? (body.kind as KnowledgeCardKind)
      : "decision";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const rationale =
    typeof body.rationale === "string" ? body.rationale.trim() : "";

  if (title.length < 3 || title.length > 180) {
    return workspaceError(
      400,
      "INVALID_TITLE",
      "Tiêu đề thẻ phải từ 3 đến 180 ký tự.",
      requestId,
    );
  }
  if (summary.length < 5 || summary.length > 2_000) {
    return workspaceError(
      400,
      "INVALID_SUMMARY",
      "Nội dung tóm tắt phải từ 5 đến 2.000 ký tự.",
      requestId,
    );
  }

  const spaceId =
    typeof body.spaceId === "string" ? body.spaceId.trim() : spaces[0]?.id ?? "spc_8f2a01";
  const matchedSpace = spaces.find((s) => s.id === spaceId) ?? spaces[0];
  const rawDocumentId =
    typeof body.documentId === "string" && body.documentId.trim()
      ? body.documentId.trim()
      : typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()
        ? body.sourceDocumentId.trim()
        : null;
  const sourceDocId = rawDocumentId;
  const sourceDoc = sourceDocId
    ? documents.find((d) => d.summary.id === sourceDocId) ?? null
    : null;

  const newCard: KnowledgeCardRecord = {
    id: `card-${randomUUID().slice(0, 12)}`,
    kind,
    status: "draft",
    title,
    summary,
    rationale,
    spaceId: matchedSpace?.id ?? spaceId,
    spaceName: matchedSpace?.name ?? "Nhân sự",
    sourceDocumentId: sourceDoc ? sourceDoc.summary.id : null,
    sourceDocumentName: sourceDoc ? sourceDoc.summary.name : null,
    sourceLocator: sourceDoc ? sourceDoc.chunks[0]?.locator ?? sourceDoc.summary.versionLabel : null,
    ownerLabel: auth.access.actorLabel,
    updatedLabel: formatToday(locale),
    version: 1,
  };

  const persisted = await createKnowledgeCards(auth.access, [newCard]);
  return workspaceJson({ ok: true, cards: persisted }, 201, requestId);
}
