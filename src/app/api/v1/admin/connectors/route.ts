import { randomUUID } from "node:crypto";

import {
  adminError,
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
  type AdminApiContext,
} from "@/server/admin/auth";
import { loadAdminConnectorsBundle } from "@/server/admin/repository";
import { parseUploadedDocumentChunks } from "@/server/ai/document-parser";
import { embedTextWithGemini, readGeminiConfig } from "@/server/ai/gemini-client";
import {
  getPreviewWorkspaceContext,
  type WorkspaceAccessContext,
} from "@/server/knowledge/access-context";
import {
  createIngestionApiKey,
  createUploadedKnowledgeDocument,
  listIngestionApiKeys,
  listKnowledgeConnectors,
  loadKnowledgeDocumentsAndSpaces,
  loadWorkspacePolicySettings,
  revokeIngestionApiKey,
  saveKnowledgeConnectorRecord,
  uploadNewDocumentVersion,
} from "@/server/knowledge/repository";
import { redactSensitiveDlpContent } from "@/server/security/dlp-redactor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminToWorkspaceAccess(admin: AdminApiContext): WorkspaceAccessContext {
  if (admin.isPreviewMode) {
    return getPreviewWorkspaceContext();
  }
  return {
    mode: "authenticated",
    workspaceId: admin.workspaceId,
    membershipId: admin.membershipId,
    workspaceRole: admin.role,
    departmentKey: null,
    userId: admin.actorId,
    actorLabel:
      admin.role === "OWNER" ? "Chủ sở hữu (OWNER)" : "Quản trị viên (ADMIN)",
    session: admin.session,
  };
}

function isSafeExternalCrawlUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      host.startsWith("169.254.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith(".internal") ||
      host.endsWith(".local")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function htmlToStructuredMarkdown(html: string, sourceUrl: string): {
  readonly title: string;
  readonly markdown: string;
} {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = (titleMatch?.[1] ?? sourceUrl)
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<\/(p|div|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    title: rawTitle.slice(0, 120) || sourceUrl,
    markdown: `# ${rawTitle || sourceUrl}\nNguồn đồng bộ: ${sourceUrl}\n\n${cleaned}`,
  };
}

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  try {
    const wsAccess = adminToWorkspaceAccess(auth.admin);
    const [bundle, knowledgeConnectors, ingestionApiKeys, wsState] =
      await Promise.all([
        loadAdminConnectorsBundle(auth.admin),
        listKnowledgeConnectors(wsAccess),
        listIngestionApiKeys(wsAccess),
        loadKnowledgeDocumentsAndSpaces(wsAccess),
      ]);
    return adminJson(
      {
        ok: true,
        ...bundle,
        knowledgeConnectors,
        ingestionApiKeys,
        spaces: wsState.spaces,
      },
      200,
      requestId,
    );
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải trạng thái kết nối và lịch sử đồng bộ.",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    action?: unknown;
    url?: unknown;
    spaceId?: unknown;
    connectorId?: unknown;
    documentId?: unknown;
    label?: unknown;
    keyId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError(400, "INVALID_JSON", "Dữ liệu gửi lên không hợp lệ.", requestId);
  }

  const wsAccess = adminToWorkspaceAccess(auth.admin);

  try {
    if (body.action === "crawl_url") {
      const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
      const parsedUrl = isSafeExternalCrawlUrl(rawUrl);
      if (!parsedUrl) {
        return adminError(
          400,
          "INVALID_URL",
          "URL không hợp lệ hoặc thuộc dải mạng nội bộ bị chặn (chỉ chấp nhận http/https công khai).",
          requestId,
        );
      }

      const spaceId =
        typeof body.spaceId === "string" && body.spaceId.trim()
          ? body.spaceId.trim()
          : "spc_8f2a01";

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let rawText = "";
      let contentType = "";
      try {
        const res = await fetch(parsedUrl.toString(), {
          signal: controller.signal,
          headers: {
            "User-Agent": "UPTECH-Enterprise-Knowledge-Crawler/2.0",
            Accept: "text/html, text/markdown, text/plain, application/xhtml+xml",
          },
        });
        if (!res.ok) {
          return adminError(
            502,
            "CRAWL_HTTP_ERROR",
            `Máy chủ nguồn trả về mã lỗi HTTP ${res.status}.`,
            requestId,
          );
        }
        contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        rawText = (await res.text()).slice(0, 250_000);
      } catch {
        return adminError(
          502,
          "CRAWL_FETCH_FAILED",
          "Không thể kết nối hoặc quá thời gian chờ (10s) khi tải nội dung từ URL nguồn.",
          requestId,
        );
      } finally {
        clearTimeout(timeout);
      }

      const extracted = contentType.includes("html")
        ? htmlToStructuredMarkdown(rawText, parsedUrl.toString())
        : {
            title: parsedUrl.hostname + parsedUrl.pathname,
            markdown: `# ${parsedUrl.hostname}${parsedUrl.pathname}\nNguồn: ${parsedUrl.toString()}\n\n${rawText}`,
          };

      const policy = await loadWorkspacePolicySettings(wsAccess);
      const sanitizedMarkdown = redactSensitiveDlpContent(
        extracted.markdown,
        policy.piiRedactionEnabled,
      ).sanitizedText;
      const bytes = new TextEncoder().encode(sanitizedMarkdown);

      const chunks = await parseUploadedDocumentChunks({
        fileName: `${extracted.title}.md`,
        extension: "md",
        bytes,
        locale: "vi",
      });

      const embeddings: Array<readonly number[] | null> = readGeminiConfig()
        ? await Promise.all(
            chunks
              .slice(0, 14)
              .map((chunk) =>
                embedTextWithGemini(`${chunk.heading}\n${chunk.content}`),
              ),
          )
        : [];

      const existingDocId =
        typeof body.documentId === "string" && body.documentId.trim()
          ? body.documentId.trim()
          : null;

      let targetDocId = existingDocId ?? `doc-url-${randomUUID().slice(0, 8)}`;

      if (existingDocId) {
        const updatedDoc = await uploadNewDocumentVersion(wsAccess, existingDocId, {
          fileName: `${extracted.title}.md`,
          extension: "md",
          byteSize: bytes.byteLength,
          rawBytes: bytes,
          chunks,
          embeddings,
          versionNote: `Đồng bộ lại tự động từ Web Connector (${parsedUrl.hostname})`,
          locale: "vi",
        });
        if (!updatedDoc) {
          targetDocId = `doc-url-${randomUUID().slice(0, 8)}`;
          await createUploadedKnowledgeDocument(wsAccess, {
            id: targetDocId,
            fileName: `${extracted.title}.md`,
            extension: "md",
            byteSize: bytes.byteLength,
            rawBytes: bytes,
            spaceId,
            chunks,
            embeddings,
            locale: "vi",
          });
        }
      } else {
        await createUploadedKnowledgeDocument(wsAccess, {
          id: targetDocId,
          fileName: `${extracted.title}.md`,
          extension: "md",
          byteSize: bytes.byteLength,
          rawBytes: bytes,
          spaceId,
          chunks,
          embeddings,
          locale: "vi",
        });
      }

      const connectorId =
        typeof body.connectorId === "string" && body.connectorId.trim()
          ? body.connectorId.trim()
          : undefined;

      await saveKnowledgeConnectorRecord(wsAccess, {
        id: connectorId,
        connectorKind: "WEB_URL",
        title: extracted.title,
        sourceUrl: parsedUrl.toString(),
        spaceId,
        documentId: targetDocId,
        chunkCount: chunks.length,
      });

      const [bundle, knowledgeConnectors, ingestionApiKeys, wsState] =
        await Promise.all([
          loadAdminConnectorsBundle(auth.admin),
          listKnowledgeConnectors(wsAccess),
          listIngestionApiKeys(wsAccess),
          loadKnowledgeDocumentsAndSpaces(wsAccess),
        ]);

      return adminJson(
        {
          ok: true,
          ...bundle,
          knowledgeConnectors,
          ingestionApiKeys,
          spaces: wsState.spaces,
        },
        201,
        requestId,
      );
    }

    if (body.action === "create_api_key") {
      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : "CI/CD & Docs Sync Key";
      const defaultSpaceId =
        typeof body.spaceId === "string" && body.spaceId.trim()
          ? body.spaceId.trim()
          : "spc_8f2a01";

      const created = await createIngestionApiKey(wsAccess, {
        label,
        defaultSpaceId,
      });
      const [bundle, knowledgeConnectors, ingestionApiKeys, wsState] =
        await Promise.all([
          loadAdminConnectorsBundle(auth.admin),
          listKnowledgeConnectors(wsAccess),
          listIngestionApiKeys(wsAccess),
          loadKnowledgeDocumentsAndSpaces(wsAccess),
        ]);

      return adminJson(
        {
          ok: true,
          createdSecretKey: created.rawSecretKey,
          ...bundle,
          knowledgeConnectors,
          ingestionApiKeys,
          spaces: wsState.spaces,
        },
        201,
        requestId,
      );
    }

    if (body.action === "revoke_api_key") {
      const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
      if (!keyId) {
        return adminError(400, "MISSING_KEY_ID", "Thiếu mã khóa API cần thu hồi.", requestId);
      }
      await revokeIngestionApiKey(wsAccess, keyId);
      const [bundle, knowledgeConnectors, ingestionApiKeys, wsState] =
        await Promise.all([
          loadAdminConnectorsBundle(auth.admin),
          listKnowledgeConnectors(wsAccess),
          listIngestionApiKeys(wsAccess),
          loadKnowledgeDocumentsAndSpaces(wsAccess),
        ]);

      return adminJson(
        {
          ok: true,
          ...bundle,
          knowledgeConnectors,
          ingestionApiKeys,
          spaces: wsState.spaces,
        },
        200,
        requestId,
      );
    }

    return adminError(400, "UNSUPPORTED_ACTION", "Thao tác kết nối không hợp lệ.", requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể thực thi tác vụ kết nối nguồn tri thức.",
    );
  }
}
