import { randomUUID } from "node:crypto";

import {
  createKnowledgeSpace,
  loadKnowledgeDocumentsAndSpaces,
} from "@/server/knowledge/repository";
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

  const { spaces } = await loadKnowledgeDocumentsAndSpaces(auth.access);
  return workspaceJson({ ok: true, spaces }, 200, requestId);
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: { name?: unknown; description?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; description?: unknown };
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON body.", requestId);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 240) : "";

  if (name.length < 2 || name.length > 80) {
    return workspaceError(
      400,
      "INVALID_NAME",
      "Tên không gian phải từ 2 đến 80 ký tự.",
      requestId,
    );
  }

  const space = await createKnowledgeSpace(auth.access, {
    id: `spc_${randomUUID().slice(0, 8)}`,
    name,
    description: description || "Không gian lưu trữ tài liệu nội bộ.",
  });

  return workspaceJson({ ok: true, space }, 201, requestId);
}
