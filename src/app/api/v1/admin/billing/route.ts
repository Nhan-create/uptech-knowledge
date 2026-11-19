import {
  adminError,
  adminJson,
  authorizeAdminApi,
  mapAdminDbError,
  resolveAdminRequestId,
} from "@/server/admin/auth";
import {
  loadAdminBillingBundle,
  saveAdminBillingProfile,
} from "@/server/admin/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await loadAdminBillingBundle(auth.admin);
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể tải thông tin gói dịch vụ và mức sử dụng.",
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveAdminRequestId(request);
  const auth = await authorizeAdminApi(request, requestId);
  if (!auth.ok) return auth.response;

  let body: {
    planCode?: unknown;
    billingCycle?: unknown;
    billingContactEmail?: unknown;
    companyLegalName?: unknown;
    taxId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError(400, "INVALID_JSON", "Payload gửi lên không hợp lệ.", requestId);
  }

  const planCode =
    body.planCode === "ENTERPRISE"
      ? "ENTERPRISE"
      : body.planCode === "GROWTH"
        ? "GROWTH"
        : body.planCode === "STARTER"
          ? "STARTER"
          : null;
  if (!planCode) {
    return adminError(400, "INVALID_PLAN", "Gói dịch vụ không hợp lệ.", requestId);
  }

  const billingCycle = body.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const billingContactEmail =
    typeof body.billingContactEmail === "string" && body.billingContactEmail.trim().length > 0
      ? body.billingContactEmail.trim().slice(0, 320)
      : null;
  if (billingContactEmail && !billingContactEmail.includes("@")) {
    return adminError(400, "INVALID_EMAIL", "Email nhận hóa đơn không hợp lệ.", requestId);
  }

  const companyLegalName =
    typeof body.companyLegalName === "string" && body.companyLegalName.trim().length > 0
      ? body.companyLegalName.trim().slice(0, 200)
      : null;
  const taxId =
    typeof body.taxId === "string" && body.taxId.trim().length > 0
      ? body.taxId.trim().slice(0, 64)
      : null;

  try {
    const bundle = await saveAdminBillingProfile(auth.admin, {
      planCode,
      billingCycle,
      billingContactEmail,
      companyLegalName,
      taxId,
    });
    return adminJson({ ok: true, ...bundle }, 200, requestId);
  } catch (error) {
    return mapAdminDbError(
      error,
      requestId,
      "Không thể lưu hồ sơ thanh toán của tổ chức.",
    );
  }
}
