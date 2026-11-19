import {
  adminError,
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
} from "@/server/admin/auth";
import {
  deletePermissionMapping,
  loadAdminPermissionsBundle,
  upsertPermissionMapping,
} from "@/server/admin/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await loadAdminPermissionsBundle(auth.admin);
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải danh sách quy tắc phân quyền của tổ chức.",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    sourceKind?: unknown;
    sourceValue?: unknown;
    targetDepartmentKey?: unknown;
    status?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError(400, "INVALID_JSON", "Payload gửi lên không hợp lệ.", requestId);
  }

  const sourceKind =
    typeof body.sourceKind === "string" ? body.sourceKind.trim().toUpperCase() : "";
  const sourceValue =
    typeof body.sourceValue === "string" ? body.sourceValue.trim() : "";
  const targetDepartmentKey =
    typeof body.targetDepartmentKey === "string" && body.targetDepartmentKey.trim().length > 0
      ? body.targetDepartmentKey.trim().toUpperCase()
      : null;
  const status =
    body.status === "DISABLED" ? "DISABLED" : "ACTIVE";

  if (!sourceKind || !sourceValue) {
    return adminError(
      400,
      "MISSING_FIELDS",
      "Vui lòng nhập đầy đủ loại nguồn và giá trị ánh xạ.",
      requestId,
    );
  }

  try {
    const mapping = await upsertPermissionMapping(auth.admin, {
      sourceKind,
      sourceValue,
      targetDepartmentKey,
      status,
    });
    const bundle = await loadAdminPermissionsBundle(auth.admin);
    return adminJson({ ok: true, mapping, ...bundle }, 201, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể lưu quy tắc phân quyền.",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  return POST(request);
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const mappingId = url.searchParams.get("mappingId")?.trim() ?? "";
  if (!UUID_PATTERN.test(mappingId)) {
    return adminError(400, "INVALID_MAPPING_ID", "Mã quy tắc phân quyền không hợp lệ.", requestId);
  }

  try {
    const deleted = await deletePermissionMapping(auth.admin, mappingId);
    if (!deleted) {
      return adminError(404, "NOT_FOUND", "Không tìm thấy quy tắc phân quyền.", requestId);
    }
    const bundle = await loadAdminPermissionsBundle(auth.admin);
    return adminJson({ ok: true, deleted: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(error, requestId, "Không thể xóa quy tắc phân quyền.");
  }
}
