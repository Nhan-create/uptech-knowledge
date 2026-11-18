import {
  generateGroundedChatAnswer,
  readGeminiConfig,
} from "@/server/ai/gemini-client";
import { rankReadyChunksHybrid } from "@/server/ai/retrieval";
import { loadKnowledgeDocumentsAndSpaces } from "@/server/knowledge/repository";
import { runtimeKnowledgeReadAdapter } from "@/server/knowledge/runtime-read-adapter";
import type { Locale } from "@/lib/preferences";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const spaceId = url.searchParams.get("space") ?? undefined;
  const fileType = url.searchParams.get("type") ?? undefined;

  const outcome = await runtimeKnowledgeReadAdapter.search({
    query,
    spaceId,
    fileType,
  });

  return workspaceJson({ ok: true, outcome }, 200, requestId);
}

/**
 * Generates an on-demand Gemini AI Search Overview strictly grounded in the top
 * matching Ready document chunks without creating a persistent chat thread.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    query?: unknown;
    spaceId?: unknown;
    fileType?: unknown;
    locale?: unknown;
  };
  try {
    body = (await request.json()) as {
      query?: unknown;
      spaceId?: unknown;
      fileType?: unknown;
      locale?: unknown;
    };
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 1_000) {
    return workspaceError(400, "INVALID_QUERY", "Search query is required.", requestId);
  }

  if (!readGeminiConfig()) {
    return workspaceJson({ ok: true, available: false }, 200, requestId);
  }

  const spaceId =
    typeof body.spaceId === "string" && body.spaceId !== "all" ? body.spaceId.trim() : undefined;
  const fileType =
    typeof body.fileType === "string" && body.fileType !== "all" ? body.fileType.trim() : undefined;
  const locale: Locale = body.locale === "en" ? "en" : "vi";

  const { spaces, documents } = await loadKnowledgeDocumentsAndSpaces(auth.access);
  const scopedDocs = documents.filter(
    (doc) =>
      (!spaceId || doc.summary.space.id === spaceId) &&
      (!fileType || doc.summary.fileType === fileType),
  );
  const excludedCount = scopedDocs.filter((d) => d.summary.processing.kind !== "ready").length;
  const ranked = await rankReadyChunksHybrid({ query, documents: scopedDocs });
  const topPassages = ranked.slice(0, 4);

  if (topPassages.length === 0) {
    return workspaceJson({ ok: true, available: false }, 200, requestId);
  }

  const scopeName = spaceId
    ? spaces.find((s) => s.id === spaceId)?.name ?? spaceId
    : locale === "vi"
      ? "Toàn workspace"
      : "All workspace";

  try {
    const answer = await generateGroundedChatAnswer({
      prompt: query,
      locale,
      scopeLabel: scopeName,
      excludedCount,
      passages: topPassages.map((item, idx) => ({
        number: idx + 1,
        documentId: item.document.summary.id,
        title: item.document.summary.name,
        location: item.chunk.locator,
        heading: item.chunk.heading,
        knowledgeSpace: item.document.summary.space.name,
        governanceWarning: item.document.summary.governance.some(
          (g) => g.kind === "deprecated",
        ),
        content: item.chunk.content,
      })),
    });

    return workspaceJson(
      {
        ok: true,
        available: true,
        model: answer.model,
        intro: answer.intro,
        points: answer.points,
        citations: topPassages.map((item, idx) => ({
          number: idx + 1,
          id: item.document.summary.id,
          title: item.document.summary.name,
          locator: item.chunk.locator,
          spaceName: item.document.summary.space.name,
        })),
      },
      200,
      requestId,
    );
  } catch {
    return workspaceJson({ ok: true, available: false }, 200, requestId);
  }
}
