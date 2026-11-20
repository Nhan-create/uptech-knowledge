import { randomUUID } from "node:crypto";

import {
  buildChatTurnResponse,
  getContextScopeLabel,
  type ChatTurn,
  type ContextScopeType,
} from "@/features/chat/chat-engine";
import type { DocumentId, SpaceId } from "@/features/knowledge/model";
import {
  GeminiServiceError,
  readGeminiConfig,
  streamHybridChatAnswer,
} from "@/server/ai/gemini-client";
import { retrieveReadyPassagesForChat } from "@/server/ai/retrieval";
import { UPTECH_CORE_SYSTEM_SUMMARY } from "@/server/knowledge/uptech-baogia-pack";
import {
  listKnowledgeCards,
  loadKnowledgeDocumentsAndSpaces,
  loadWorkspacePolicySettings,
  savePersistedChatTurn,
  type KnowledgeCardRecord,
  type StoredKnowledgeDocument,
} from "@/server/knowledge/repository";
import { redactSensitiveDlpContent } from "@/server/security/dlp-redactor";
import type { Locale } from "@/lib/preferences";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESET_SCOPES = new Set<string>([
  "workspace",
  "space:hr",
  "space:operations",
  "space:atlas",
  "selected-documents",
]);

function isSupportedScope(value: unknown): value is ContextScopeType {
  if (typeof value !== "string") return false;
  if (PRESET_SCOPES.has(value)) return true;
  return /^space:[a-zA-Z0-9_-]{2,80}$/u.test(value);
}

function cardsToSyntheticDocuments(
  cards: readonly KnowledgeCardRecord[],
  requireVerifiedOnly: boolean,
  locale: Locale,
): readonly StoredKnowledgeDocument[] {
  return cards
    .filter((card) =>
      requireVerifiedOnly
        ? card.status === "verified"
        : card.status === "verified" || card.status === "draft",
    )
    .map((card) => {
      const docId = `card-${card.id}` as DocumentId;
      const spaceId = (card.spaceId || "spc_8f2a01") as SpaceId;
      const statusLabel =
        card.status === "verified"
          ? locale === "en"
            ? "Verified Card"
            : "Thẻ tri thức đã xác minh"
          : locale === "en"
            ? "Draft Card"
            : "Thẻ tri thức bản nháp";
      const content = [card.summary, card.rationale].filter(Boolean).join("\n\n");
      return {
        summary: {
          id: docId,
          name: `[Thẻ tri thức] ${card.title}`,
          fileType: "md",
          versionLabel: `v${card.version}.0`,
          detail: statusLabel,
          ownerLabel: card.ownerLabel,
          updatedLabel: card.updatedLabel,
          space: { id: spaceId, name: card.spaceName },
          processing: {
            kind: "ready",
            label: locale === "en" ? "Ready" : "Sẵn sàng",
            description: statusLabel,
          },
          governance: [
            {
              kind: card.status === "verified" ? "verified" : "needs-review",
              label: statusLabel,
              description: statusLabel,
              variant: card.status === "verified" ? "success" : "info",
            },
          ],
          chunkCount: 1,
        },
        versions: [
          {
            id: `${docId}-v${card.version}`,
            label: `v${card.version}.0`,
            updatedLabel: card.updatedLabel,
          },
        ],
        isUserUploaded: card.status === "verified",
        byteSize: Buffer.byteLength(content, "utf8"),
        chunks: [
          {
            chunkId: `${docId}-chunk-0`,
            documentId: docId,
            chunkIndex: 0,
            heading: card.title,
            locator: card.sourceLocator || statusLabel,
            content,
          },
        ],
      };
    });
}

interface ChatPostPayload {
  prompt?: unknown;
  scope?: unknown;
  selectedDocumentIds?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  replaceTurnId?: unknown;
  locale?: unknown;
  history?: unknown;
  stream?: unknown;
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

  const scope: ContextScopeType = isSupportedScope(body.scope)
    ? body.scope
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
  const wantsStream =
    body.stream === true ||
    (request.headers.get("accept") ?? "").includes("text/event-stream");

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

  const access = auth.access;

  async function executeChatSynthesis(
    emitEvent?: (event: string, data: unknown) => void,
  ) {
    emitEvent?.("stage", { stage: "preparing" });
    const [{ spaces, documents }, cards, policy] = await Promise.all([
      loadKnowledgeDocumentsAndSpaces(access),
      listKnowledgeCards(access).catch(() => [] as readonly KnowledgeCardRecord[]),
      loadWorkspacePolicySettings(access),
    ]);

    const cardDocuments =
      scope === "selected-documents"
        ? []
        : cardsToSyntheticDocuments(
            cards,
            policy.requireVerifiedCardsInChat,
            locale,
          );
    const combinedDocuments = [...cardDocuments, ...documents];

    emitEvent?.("stage", { stage: "retrieving" });
    const retrieval = await retrieveReadyPassagesForChat({
      prompt,
      scope,
      selectedDocumentIds,
      documents: combinedDocuments,
    });

    emitEvent?.("citations", {
      evidenceState: retrieval.evidenceState,
      citations: retrieval.hasRelevantMatch ? retrieval.citations : [],
      excludedCount: retrieval.excludedCount,
    });

    let turn: ChatTurn;
    let provider: "gemini" | "local-fallback" | "no-evidence" = "no-evidence";
    let modelName: string | undefined;

    const scopeLabel =
      scope === "selected-documents" && selectedDocumentIds.length > 0
        ? locale === "vi"
          ? `Chỉ tài liệu đã chọn (${selectedDocumentIds.length} tệp)`
          : `Pinned documents (${selectedDocumentIds.length})`
        : getContextScopeLabel(scope, locale, selectedDocumentIds.length, spaces);

    const geminiConfig = readGeminiConfig();
    const canUseGemini =
      Boolean(geminiConfig) &&
      !(
        scope === "selected-documents" &&
        selectedDocumentIds.length > 0 &&
        retrieval.passages.length === 0
      );

    if (canUseGemini) {
      emitEvent?.("stage", { stage: "generating" });
      const useSources =
        retrieval.passages.length > 0 && retrieval.hasRelevantMatch;
      const dlpPrompt = redactSensitiveDlpContent(
        prompt,
        policy.piiRedactionEnabled,
      );
      const geminiAnswer = await streamHybridChatAnswer({
        prompt: dlpPrompt.sanitizedText,
        locale,
        history,
        uptechOverview: UPTECH_CORE_SYSTEM_SUMMARY,
        passages: useSources
          ? retrieval.passages.map((passage) => ({
              number: passage.number,
              documentId: passage.document.summary.id,
              title: passage.document.summary.name,
              location: passage.chunk.locator,
              heading: passage.chunk.heading,
              knowledgeSpace: passage.document.summary.space.name,
              governanceWarning: passage.isDeprecated,
              content: redactSensitiveDlpContent(
                passage.chunk.content,
                policy.piiRedactionEnabled,
              ).sanitizedText,
            }))
          : [],
        onDelta: (delta) => emitEvent?.("delta", { delta }),
      });

      provider = "gemini";
      modelName = geminiAnswer.model;
      const deprecationWarning =
        useSources && retrieval.evidenceState === "caution"
          ? locale === "vi"
            ? "Lưu ý: có nguồn được đánh dấu phiên bản cũ/ngừng dùng; cần đối chiếu trước khi áp dụng."
            : "Caution: at least one cited source is marked deprecated; verify before applying."
          : "";
      const excludedNote =
        useSources && retrieval.excludedCount > 0
          ? locale === "vi"
            ? `Đã loại trừ ${retrieval.excludedCount} tệp đang xử lý/OCR theo quy tắc Ready-Only.`
            : `Excluded ${retrieval.excludedCount} non-Ready file(s) under Ready-Only rules.`
          : "";

      turn = {
        id: turnId,
        prompt,
        scope,
        scopeLabel,
        evidenceState: useSources ? retrieval.evidenceState : "grounded",
        intro: geminiAnswer.intro,
        points: [],
        footnote: [deprecationWarning, excludedNote].filter(Boolean).join(" "),
        citations: useSources ? [...retrieval.citations] : [],
        excludedProcessingCount: useSources ? retrieval.excludedCount : 0,
        feedback: null,
      };
    } else if (retrieval.evidenceState === "empty" || retrieval.passages.length === 0) {
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
    } else {
      emitEvent?.("stage", { stage: "generating" });
      provider = "local-fallback";
      const readySummaries = combinedDocuments.map((d) => d.summary);
      const readyDetails = combinedDocuments
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
        combinedDocuments
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

    const session = await savePersistedChatTurn(access, {
      sessionId,
      title: prompt,
      scope,
      turn,
      replaceTurnId,
      modelName,
    });

    return {
      ok: true as const,
      provider,
      model: modelName ?? null,
      session,
      turn,
    };
  }

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };
        try {
          const result = await executeChatSynthesis(send);
          send("done", result);
        } catch (error) {
          const message =
            error instanceof GeminiServiceError
              ? locale === "vi"
                ? "Không thể kết nối máy chủ AI ngay lúc này. Vui lòng thử lại."
                : "AI synthesis failed. Please retry."
              : error instanceof Error
                ? error.message
                : "Failed to synthesize response.";
          send("error", { ok: false, error: { message } });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  }

  try {
    const result = await executeChatSynthesis();
    return workspaceJson(result, 200, requestId);
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
    const message =
      error instanceof Error ? error.message : "Failed to synthesize response.";
    return workspaceError(500, "INTERNAL_ERROR", message, requestId);
  }
}
