import { runtimeKnowledgeReadAdapter } from "@/server/knowledge/runtime-read-adapter";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: { leftId?: unknown; rightId?: unknown };
  try {
    body = (await request.json()) as { leftId?: unknown; rightId?: unknown };
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const leftId = typeof body.leftId === "string" ? body.leftId.trim() : "";
  const rightId = typeof body.rightId === "string" ? body.rightId.trim() : "";

  const outcome = await runtimeKnowledgeReadAdapter.compare({
    leftId: leftId || undefined,
    rightId: rightId || undefined,
  });

  return workspaceJson({ ok: true, outcome }, 200, requestId);
}
