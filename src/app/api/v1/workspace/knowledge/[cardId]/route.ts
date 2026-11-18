import {
  deleteKnowledgeCard,
  updateKnowledgeCard,
  type KnowledgeCardKind,
  type KnowledgeCardStatus,
} from "@/server/knowledge/repository";
import type { Locale } from "@/lib/preferences";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<KnowledgeCardStatus>([
  "draft",
  "verified",
  "archived",
]);
const VALID_KINDS = new Set<KnowledgeCardKind>([
  "decision",
  "open-question",
  "rule",
]);

function isValidCardId(cardId: string): boolean {
  return Boolean(cardId && /^[a-zA-Z0-9_-]{3,80}$/.test(cardId));
}

export async function PATCH(
  request: Request,
  context: Readonly<{ params: Promise<{ cardId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { cardId } = await context.params;
  if (!isValidCardId(cardId)) {
    return workspaceError(400, "INVALID_CARD_ID", "Invalid knowledge card id.", requestId);
  }

  let body: {
    status?: unknown;
    kind?: unknown;
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
    locale?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const locale: Locale = body.locale === "en" ? "en" : "vi";
  const status =
    typeof body.status === "string" && VALID_STATUSES.has(body.status as KnowledgeCardStatus)
      ? (body.status as KnowledgeCardStatus)
      : undefined;
  const kind =
    typeof body.kind === "string" && VALID_KINDS.has(body.kind as KnowledgeCardKind)
      ? (body.kind as KnowledgeCardKind)
      : undefined;
  const title = typeof body.title === "string" ? body.title : undefined;
  const summary = typeof body.summary === "string" ? body.summary : undefined;
  const rationale = typeof body.rationale === "string" ? body.rationale : undefined;

  const updated = await updateKnowledgeCard(auth.access, cardId, {
    status,
    kind,
    title,
    summary,
    rationale,
    locale,
  });

  if (!updated) {
    return workspaceError(404, "NOT_FOUND", "Knowledge card not found.", requestId);
  }

  return workspaceJson({ ok: true, card: updated }, 200, requestId);
}

export async function DELETE(
  request: Request,
  context: Readonly<{ params: Promise<{ cardId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { cardId } = await context.params;
  if (!isValidCardId(cardId)) {
    return workspaceError(400, "INVALID_CARD_ID", "Invalid knowledge card id.", requestId);
  }

  const deleted = await deleteKnowledgeCard(auth.access, cardId);
  if (!deleted) {
    return workspaceError(404, "NOT_FOUND", "Knowledge card not found.", requestId);
  }

  return workspaceJson({ ok: true, deletedId: cardId }, 200, requestId);
}
