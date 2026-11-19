import {
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
} from "@/server/admin/auth";
import { loadAdminConnectorsBundle } from "@/server/admin/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await loadAdminConnectorsBundle(auth.admin);
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải trạng thái kết nối và lịch sử đồng bộ.",
    );
  }
}
