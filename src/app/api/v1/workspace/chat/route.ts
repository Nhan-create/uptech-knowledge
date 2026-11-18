import { randomUUID } from "node:crypto";

import {
  buildChatTurnResponse,
  getContextScopeLabel,
  type ChatTurn,
  type ContextScopeType,
} from "@/features/chat/chat-engine";
import {
  generateGroundedChatAnswer,
  GeminiServiceError,
  readGeminiConfig,
} from "@/server/ai/gemini-client";
import { retrieveReadyPassagesForChat } from "@/server/ai/retrieval";
import {
  loadKnowledgeDocumentsAndSpaces,
  savePersistedChatTurn,
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

const VALID_SCOPES = new Set<ContextScopeType>([
  "workspace",
  "space:hr",
  "space:operations",
  "space:atlas",
  "selected-documents",
]);

interface ChatPostPayload {
  prompt?: unknown;
  scope?: unknown;
  selectedDocumentIds?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  replaceTurnId?: unknown;
  locale?: unknown;
  history?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: ChatPostPayload;
  try {
    body = (await request.json()) as ChatPostPayload;
  } catch {
    return workspaceError(400, "INVALID_JSON", "Request body must be valid JSON.", requestId);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length === 0 || prompt.length > 4_000) {
    return workspaceError(
      400,
      "INVALID_PROMPT",
      "Prompt must be between 1 and 4,000 characters.",
      requestId,
    );
  }

  const scope: ContextScopeType =
    typeof body.scope === "string" && VALID_SCOPES.has(body.scope as ContextScopeType)
      ? (body.scope as ContextScopeType)
      : "workspace";

  const selectedDocumentIds = Array.isArray(body.selectedDocumentIds)
    ? body.selectedDocumentIds.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];

  const locale: Locale = body.locale === "en" ? "en" : "vi";
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim().length > 0
      ? body.sessionId.trim().slice(0, 128)
      : `sess-${randomUUID()}`;
  const turnId =
    typeof body.turnId === "string" && body.turnId.trim().length > 0
      ? body.turnId.trim().slice(0, 128)
      : `turn-${randomUUID()}`;
  const replaceTurnId =
    typeof body.replaceTurnId === "string" && body.replaceTurnId.trim().length > 0
      ? body.replaceTurnId.trim().slice(0, 128)
      : undefined;

  const history = Array.isArray(body.history)
    ? body.history
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as { prompt?: unknown; answerSummary?: unknown };
          if (
            typeof record.prompt !== "string" ||
            typeof record.answerSummary !== "string"
          ) {
            return null;
          }
          return {
            prompt: record.prompt.slice(0, 600),
            answerSummary: record.answerSummary.slice(0, 1_200),
          };
        })
        .filter((item): item is { prompt: string; answerSummary: string } => item !== null)
    : [];

  try {
    const { spaces, documents } = await loadKnowledgeDocumentsAndSpaces(auth.access);
    const retrieval = await retrieveReadyPassagesForChat({
      prompt,
      scope,
      selectedDocumentIds,
      documents,
    });

    let turn: ChatTurn;
    let provider: "gemini" | "local-fallback" | "no-evidence" = "no-evidence";
    let modelName: string | undefined;

    const scopeLabel =
      scope === "selected-documents" && selectedDocumentIds.length > 0
        ? locale === "vi"
          ? `Chỉ tài liệu đã chọn (${selectedDocumentIds.length} tệp)`
          : `Pinned documents (${selectedDocumentIds.length})`
        : getContextScopeLabel(scope, locale);

    if (retrieval.evidenceState === "empty" || retrieval.passages.length === 0) {
      turn = {
        id: turnId,
        prompt,
        scope,
        scopeLabel,
        evidenceState: "empty",
        intro:
          locale === "vi"
            ? `Chưa có tài liệu ở trạng thái Sẵn sàng trong phạm vi "${scopeLabel}" để trả lời câu hỏi này.`
            : `No Ready documents are available in "${scopeLabel}" to answer this question.`,
        points: [],
        footnote:
          retrieval.excludedCount > 0
            ? locale === "vi"
              ? `Đã loại trừ ${retrieval.excludedCount} tệp đang xử lý/OCR theo quy tắc Ready-Only.`
              : `Excluded ${retrieval.excludedCount} non-Ready document(s) under Ready-Only rules.`
            : "",
        citations: [],
        excludedProcessingCount: retrieval.excludedCount,
        feedback: null,
      };
    } else if (readGeminiConfig()) {
      try {
        const geminiAnswer = await generateGroundedChatAnswer({
          prompt,
          locale,
          scopeLabel,
          excludedCount: retrieval.excludedCount,
          history,
          passages: retrieval.passages.map((passage) => ({
            number: passage.number,
            documentId: passage.document.summary.id,
            title: passage.document.summary.name,
            location: passage.chunk.locator,
            heading: passage.chunk.heading,
            knowledgeSpace: passage.document.summary.space.name,
            governanceWarning: passage.isDeprecated,
            content: passage.chunk.content,
          })),
        });

        provider = "gemini";
        modelName = geminiAnswer.model;
        const deprecationWarning =
          retrieval.evidenceState === "caution"
            ? locale === "vi"
              ? "Lưu ý: có nguồn được đánh dấu phiên bản cũ/ngừng dùng; cần đối chiếu trước khi áp dụng."
              : "Caution: at least one cited source is marked deprecated; verify before applying."
            : "";
        const excludedNote =
          retrieval.excludedCount > 0
            ? locale === "vi"
              ? `Đã loại trừ ${retrieval.excludedCount} tệp đang xử lý/OCR theo quy tắc Ready-Only.`
              : `Excluded ${retrieval.excludedCount} non-Ready file(s) under Ready-Only rules.`
            : "";

        turn = {
          id: turnId,
          prompt,
          scope,
          scopeLabel,
          evidenceState: retrieval.evidenceState,
          intro: geminiAnswer.intro,
          points: geminiAnswer.points,
          footnote: [deprecationWarning, excludedNote].filter(Boolean).join(" "),
          citations: [...retrieval.citations],
          excludedProcessingCount: retrieval.excludedCount,
          feedback: null,
        };
      } catch (error) {
        if (error instanceof GeminiServiceError) {
          return workspaceError(
            502,
            "AI_PROVIDER_ERROR",
            locale === "vi"
              ? "Không thể kết nối máy chủ AI ngay lúc này. Vui lòng thử lại."
              : "AI synthesis failed. Please retry.",
            requestId,
          );
        }
        throw error;
      }
    } else {
      provider = "local-fallback";
      const readySummaries = documents.map((d) => d.summary);
      const readyDetails = documents
        .filter((d) => d.summary.processing.kind === "ready" && d.chunks.length > 0)
        .map((d) => ({
          ...d.summary,
          versions: d.versions,
          preview: {
            kind: "fixture-excerpt" as const,
            heading: d.chunks[0]!.heading,
            locator: d.chunks[0]!.locator,
            excerpt: d.chunks[0]!.content,
          },
        }));
      const localTextById = Object.fromEntries(
        documents
          .filter((d) => d.chunks.length > 0)
          .map((d) => [d.summary.id, d.chunks.map((c) => c.content).join("\n\n")]),
      );
      turn = buildChatTurnResponse({
        id: turnId,
        prompt,
        scope,
        selectedDocumentIds,
        documents: readySummaries,
        readyDetails,
        localTextById,
        spaces,
        locale,
      });
    }

    const session = await savePersistedChatTurn(auth.access, {
      sessionId,
      title: prompt,
      scope,
      turn,
      replaceTurnId,
      modelName,
    });

    return workspaceJson(
      {
        ok: true,
        provider,
        model: modelName ?? null,
        session,
        turn,
      },
      200,
      requestId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to synthesize response.";
    return workspaceError(500, "INTERNAL_ERROR", message, requestId);
  }
}
