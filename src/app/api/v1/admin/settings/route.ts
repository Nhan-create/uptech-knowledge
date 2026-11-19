import {
  adminError,
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
} from "@/server/admin/auth";
import {
  loadAdminSettingsBundle,
  saveAdminSettings,
} from "@/server/admin/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await loadAdminSettingsBundle(auth.admin);
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải thiết lập của tổ chức.",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    organizationName?: unknown;
    defaultLocale?: unknown;
    retentionDays?: unknown;
    maxUploadMb?: unknown;
    allowMemberUploads?: unknown;
    requireVerifiedCardsInChat?: unknown;
    auditExportEnabled?: unknown;
    provisioningPolicy?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError(400, "INVALID_JSON", "Payload gửi lên không hợp lệ.", requestId);
  }

  const organizationName =
    typeof body.organizationName === "string" ? body.organizationName.trim() : "";
  if (organizationName.length < 1 || organizationName.length > 120) {
    return adminError(
      400,
      "INVALID_ORGANIZATION_NAME",
      "Tên tổ chức phải từ 1 đến 120 ký tự.",
      requestId,
    );
  }

  const defaultLocale = body.defaultLocale === "en" ? "en" : "vi";
  const retentionDays = Number(body.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) {
    return adminError(
      400,
      "INVALID_RETENTION_DAYS",
      "Thời gian lưu trữ dữ liệu phải nằm trong khoảng 30 đến 3650 ngày.",
      requestId,
    );
  }

  const maxUploadMb = Number(body.maxUploadMb);
  if (!Number.isInteger(maxUploadMb) || maxUploadMb < 1 || maxUploadMb > 100) {
    return adminError(
      400,
      "INVALID_MAX_UPLOAD_MB",
      "Giới hạn dung lượng tệp tải lên phải từ 1 đến 100 MB.",
      requestId,
    );
  }

  const provisioningPolicy =
    body.provisioningPolicy === "INVITE_ONLY" ||
    body.provisioningPolicy === "GOOGLE_GROUP_CONTROLLED"
      ? body.provisioningPolicy
      : undefined;

  try {
    const bundle = await saveAdminSettings(auth.admin, {
      organizationName,
      defaultLocale,
      retentionDays,
      maxUploadMb,
      allowMemberUploads: body.allowMemberUploads !== false,
      requireVerifiedCardsInChat: body.requireVerifiedCardsInChat === true,
      auditExportEnabled: body.auditExportEnabled !== false,
      provisioningPolicy,
    });
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể lưu thiết lập tổ chức.",
    );
  }
}
