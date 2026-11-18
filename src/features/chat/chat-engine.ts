import {
  findHeroMatchingDocuments,
  normalizeFold,
} from "@/features/dashboard/hero-matching";
import type {
  DocumentDetailView,
  DocumentSummaryView,
  SpaceSummaryView,
} from "@/features/knowledge/model";
import type { Locale } from "@/lib/preferences";
import { extractBestMatchingExcerpt } from "@/features/chat/local-file-ingest";

export type ChatFixtureScope = "workspace" | "hr" | "operations" | "atlas";

export type ContextScopeType =
  | "workspace"
  | "space:hr"
  | "space:operations"
  | "space:atlas"
  | "selected-documents";

export type ChatTurnEvidenceState = "grounded" | "caution" | "empty";

export type ChatCitationSource = Readonly<{
  id: string;
  number: number;
  title: string;
  fileType: "pdf" | "docx" | "md";
  version: string;
  location: string;
  heading: string;
  quote: string;
  knowledgeSpace: string;
  spaceId: string;
  statusLabel: string;
  ownerLabel: string;
  updatedLabel: string;
  isDeprecated: boolean;
  isLocalUpload?: boolean;
}>;

export type ChatAnswerPoint = Readonly<{
  heading: string;
  detail: string;
  citationNumber: number;
}>;

export type ChatTurn = Readonly<{
  id: string;
  prompt: string;
  scope: ContextScopeType;
  scopeLabel: string;
  evidenceState: ChatTurnEvidenceState;
  intro: string;
  points: readonly ChatAnswerPoint[];
  footnote: string;
  citations: readonly ChatCitationSource[];
  excludedProcessingCount: number;
  feedback: "up" | "down" | null;
}>;

export type ChatStarterPrompt = Readonly<{
  id: string;
  scope: ContextScopeType;
  vi: string;
  en: string;
}>;

export const CHAT_STARTER_PROMPTS: readonly ChatStarterPrompt[] = [
  {
    id: "remote-policy",
    scope: "space:hr",
    vi: "Quy định làm việc từ xa 2026 và nghĩa vụ bảo mật",
    en: "Remote work policy 2026 and security obligations",
  },
  {
    id: "team-handbook",
    scope: "space:hr",
    vi: "Quản lý cần thống nhất gì với đội nhóm phân tán?",
    en: "How should managers coordinate distributed teams?",
  },
  {
    id: "atlas-handover",
    scope: "space:atlas",
    vi: "Cách ghi nhận đầu việc còn mở sau bàn giao dự án",
    en: "How are open handover items tracked?",
  },
  {
    id: "summarize-scope",
    scope: "workspace",
    vi: "Tóm tắt các tài liệu Sẵn sàng trong phạm vi đang chọn",
    en: "Summarize Ready sources in the active scope",
  },
] as const;

export const CONTEXT_SCOPE_TO_SPACE_ID: Readonly<
  Record<Exclude<ContextScopeType, "selected-documents">, string>
> = {
  workspace: "all",
  "space:hr": "spc_8f2a01",
  "space:operations": "spc_c14d72",
  "space:atlas": "spc_6be903",
};

export const FIXTURE_TO_CONTEXT_SCOPE: Readonly<
  Record<ChatFixtureScope, ContextScopeType>
> = {
  workspace: "workspace",
  hr: "space:hr",
  operations: "space:operations",
  atlas: "space:atlas",
};

export function resolveScopeToSpaceId(scope: ContextScopeType): string {
  if (scope === "selected-documents") return "all";
  return CONTEXT_SCOPE_TO_SPACE_ID[scope];
}

export function getContextScopeLabel(
  scope: ContextScopeType,
  locale: Locale,
  selectedSourceCount = 0,
): string {
  if (locale === "en") {
    switch (scope) {
      case "workspace":
        return "All workspace";
      case "space:hr":
        return "Space: Nhân sự";
      case "space:operations":
        return "Space: Vận hành";
      case "space:atlas":
        return "Space: Dự án Atlas";
      case "selected-documents":
        return selectedSourceCount > 0
          ? `${selectedSourceCount} selected docs`
          : "Selected documents (none)";
    }
  }

  switch (scope) {
    case "workspace":
      return "Toàn workspace";
    case "space:hr":
      return "Không gian: Nhân sự";
    case "space:operations":
      return "Không gian: Vận hành";
    case "space:atlas":
      return "Không gian: Dự án Atlas";
    case "selected-documents":
      return selectedSourceCount > 0
        ? `Chỉ ${selectedSourceCount} tài liệu đã chọn`
        : "Chỉ tài liệu đã chọn (chưa có nguồn)";
  }
}

function isSummaryIntent(query: string): boolean {
  const folded = normalizeFold(query);
  return (
    folded.includes("tom tat") ||
    folded.includes("tong hop") ||
    folded.includes("co tai lieu nao") ||
    folded.includes("danh sach tai lieu") ||
    /\b(summary|summarize|overview|available)\b/.test(folded)
  );
}

/**
 * Synthesize a grounded, Ready-Only AI turn from workspace fixture documents.
 * Non-ready documents (OCR, validating, extracting, uploading, failed) are
 * never cited as evidence and are reported transparently via excluded counts.
 */
export function buildChatTurnResponse({
  id,
  prompt,
  scope,
  selectedDocumentIds = [],
  documents,
  readyDetails,
  spaces,
  locale,
  localTextById,
}: Readonly<{
  id: string;
  prompt: string;
  scope: ContextScopeType;
  selectedDocumentIds?: readonly string[];
  documents: readonly DocumentSummaryView[];
  readyDetails: readonly DocumentDetailView[];
  spaces: readonly SpaceSummaryView[];
  locale: Locale;
  localTextById?: Readonly<Record<string, string>>;
}>): ChatTurn {
  const cleanedPrompt = prompt.trim();
  const detailMap = new Map(readyDetails.map((doc) => [doc.id, doc]));
  const spaceId = resolveScopeToSpaceId(scope);

  const selectedSet = new Set(selectedDocumentIds);
  const candidateDocs =
    scope === "selected-documents"
      ? documents.filter((doc) => selectedSet.has(doc.id))
      : documents;

  const matchResult = findHeroMatchingDocuments(candidateDocs, cleanedPrompt, spaceId, {
    getExtraText: (doc) => {
      const localRaw = localTextById?.[doc.id] ?? "";
      const detail = detailMap.get(doc.id);
      if (detail?.preview.kind === "fixture-excerpt") {
        return `${detail.preview.heading} ${detail.preview.excerpt} ${detail.preview.locator} ${localRaw}`;
      }
      return localRaw;
    },
  });

  const scopedDocs =
    spaceId === "all"
      ? candidateDocs
      : candidateDocs.filter((doc) => doc.space.id === spaceId);
  const scopedReady = scopedDocs.filter((doc) => doc.processing.kind === "ready");

  const chosenDocs =
    matchResult.matches.length > 0
      ? matchResult.matches
      : matchResult.readyCountInScope > 0 &&
          (scope === "selected-documents" || isSummaryIntent(cleanedPrompt))
        ? scopedReady.slice(0, 3)
        : [];

  const citations: ChatCitationSource[] = chosenDocs.map((doc, idx) => {
    const detail = detailMap.get(doc.id);
    const preview = detail?.preview.kind === "fixture-excerpt" ? detail.preview : null;
    const localRaw = localTextById?.[doc.id];
    const localSnippet = localRaw
      ? extractBestMatchingExcerpt(localRaw, cleanedPrompt, locale)
      : null;
    const govLabels = doc.governance.map((g) => g.label).join(" · ");
    const isDeprecated = doc.governance.some(
      (g) => g.kind === "deprecated" || g.kind === "expired",
    );

    return {
      id: doc.id,
      number: idx + 1,
      title: doc.name,
      fileType: doc.fileType,
      version: doc.versionLabel,
      location:
        localSnippet?.locator ??
        preview?.locator ??
        (locale === "en" ? "Ready document" : "Tài liệu Sẵn sàng"),
      heading: preview?.heading ?? doc.name,
      quote: localSnippet?.excerpt ?? preview?.excerpt ?? doc.detail,
      knowledgeSpace: doc.space.name,
      spaceId: doc.space.id,
      statusLabel: govLabels ? `${doc.processing.label} · ${govLabels}` : doc.processing.label,
      ownerLabel: doc.ownerLabel,
      updatedLabel: doc.updatedLabel,
      isDeprecated,
      isLocalUpload: doc.id.startsWith("local-"),
    };
  });

  const scopeLabel = getContextScopeLabel(scope, locale, selectedDocumentIds.length);
  const spaceObj = spaces.find((s) => s.id === spaceId);
  const activeSpaceName = spaceObj?.name ?? scopeLabel;
  const excludedCount = matchResult.nonReadyCountInScope;

  if (citations.length === 0) {
    const isNoReadyInScope = matchResult.readyCountInScope === 0;
    return {
      id,
      prompt: cleanedPrompt,
      scope,
      scopeLabel,
      evidenceState: "empty",
      intro:
        locale === "en"
          ? isNoReadyInScope
            ? `No Ready documents are currently indexed in "${activeSpaceName}", so AI Chat cannot synthesize a grounded answer from this scope yet.`
            : `No Ready passages matched "${cleanedPrompt}" inside "${scopeLabel}". No fallback speculation was generated.`
          : isNoReadyInScope
            ? `Phạm vi "${activeSpaceName}" hiện chưa có tài liệu Sẵn sàng nào, nên Trợ lý AI không thể tổng hợp câu trả lời có trích dẫn từ phạm vi này.`
            : `Không tìm thấy đoạn trích Sẵn sàng nào khớp với câu hỏi "${cleanedPrompt}" trong phạm vi "${scopeLabel}". Trợ lý AI dừng trả lời thay vì suy đoán.`,
      points: [],
      footnote:
        locale === "en"
          ? excludedCount > 0
            ? `${excludedCount} non-ready/processing file(s) in this scope are excluded per Ready-Only rules. Switch to All workspace or inspect Search.`
            : `Try broadening scope to All workspace or picking one of the Ready starter queries.`
          : excludedCount > 0
            ? `Đã tự động loại ${excludedCount} tệp đang xử lý/OCR/chưa sẵn sàng theo quy tắc Ready-Only. Bạn có thể chuyển phạm vi sang Toàn workspace hoặc mở Tìm kiếm.`
            : `Thử mở rộng phạm vi sang Toàn workspace hoặc chọn một câu hỏi gợi ý bên dưới.`,
      citations: [],
      excludedProcessingCount: excludedCount,
      feedback: null,
    };
  }

  const hasDeprecated = citations.some((c) => c.isDeprecated);
  const evidenceState: ChatTurnEvidenceState = hasDeprecated ? "caution" : "grounded";

  const points: ChatAnswerPoint[] = citations.map((citation) => ({
    heading: citation.heading,
    detail: citation.quote,
    citationNumber: citation.number,
  }));

  const intro =
    locale === "en"
      ? `Based on ${citations.length} verified Ready source${citations.length === 1 ? "" : "s"} in "${scopeLabel}", here are the matching passages:`
      : `Dựa trên ${citations.length} tài liệu Sẵn sàng trong phạm vi "${scopeLabel}", dưới đây là các điểm khớp trực tiếp:`;

  const footnoteParts: string[] = [];
  if (hasDeprecated) {
    footnoteParts.push(
      locale === "en"
        ? "Note: At least one cited file carries a Deprecated governance tag — verify newer drafts before applying."
        : "Lưu ý: Nguồn trích dẫn có gắn nhãn Deprecated — cần đối chiếu bản cập nhật mới trước khi áp dụng.",
    );
  }
  if (excludedCount > 0) {
    footnoteParts.push(
      locale === "en"
        ? `${excludedCount} processing/non-ready file(s) in this scope were excluded per Ready-Only rules.`
        : `Đã loại trừ ${excludedCount} tệp đang xử lý/OCR hoặc chưa sẵn sàng theo quy tắc Ready-Only.`,
    );
  }
  if (footnoteParts.length === 0) {
    footnoteParts.push(
      locale === "en"
        ? "Click any citation chip [1]..[N] to inspect its full excerpt and location in the Source Reader."
        : "Bấm trực tiếp thẻ nguồn [1]..[N] để mở trích đoạn gốc và vị trí trang trong Trình đọc nguồn.",
    );
  }

  return {
    id,
    prompt: cleanedPrompt,
    scope,
    scopeLabel,
    evidenceState,
    intro,
    points,
    footnote: footnoteParts.join(" "),
    citations,
    excludedProcessingCount: excludedCount,
    feedback: null,
  };
}

/** Render a grounded chat turn into clean plain text for clipboard copy. */
export function formatChatTurnForCopy(turn: ChatTurn, locale: Locale): string {
  const lines = [
    `${locale === "en" ? "Question" : "Câu hỏi"}: ${turn.prompt}`,
    `${locale === "en" ? "Scope" : "Phạm vi"}: ${turn.scopeLabel}`,
    "",
    turn.intro,
  ];
  for (const point of turn.points) {
    lines.push(`- ${point.heading}: ${point.detail} [${point.citationNumber}]`);
  }
  if (turn.citations.length > 0) {
    lines.push("");
    lines.push(locale === "en" ? "Sources:" : "Nguồn trích dẫn:");
    for (const c of turn.citations) {
      lines.push(`[${c.number}] ${c.title} (${c.location} · ${c.version})`);
    }
  }
  return lines.join("\n");
}
