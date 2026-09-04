import type { Locale } from "../../lib/preferences.ts";
import type { RecoveryState } from "../../server/auth/recovery-actions.ts";

export type LoginRecoverySurfaceCopy = Readonly<{
  title: string;
  description: string;
  isError: boolean;
}>;

export type LoginRecoveryShellCopy = Readonly<{
  home: string;
  homeAriaLabel: string;
  requestIdLabel: string;
  redirectingLabel: string;
}>;

type LoginRecoveryLocaleCopy = Readonly<{
  normal: LoginRecoverySurfaceCopy;
  states: Readonly<Record<RecoveryState, LoginRecoverySurfaceCopy>>;
  shell: LoginRecoveryShellCopy;
}>;

const recovery = (title: string, description: string): LoginRecoverySurfaceCopy =>
  Object.freeze({ title, description, isError: true });

const VI_RECOVERY_COPY = Object.freeze({
  PERSONAL_GOOGLE_ACCOUNT: recovery("Cần tài khoản công ty", "UPTECH chỉ hỗ trợ tài khoản Google Workspace của doanh nghiệp."),
  UNKNOWN_WORKSPACE: recovery("Tổ chức chưa được thiết lập", "Tài khoản công ty đã được Google xác minh, nhưng tổ chức chưa được thiết lập trên UPTECH."),
  SUPER_ADMIN_REQUIRED: recovery("Cần quyền Super Admin", "Tài khoản thuộc công ty nhưng không có quyền Google Workspace Super Admin để thiết lập tổ chức."),
  DELEGATED_ADMIN_UNSUPPORTED: recovery("Cần quyền Super Admin", "Quyền quản trị được ủy quyền chưa đủ để thiết lập tổ chức trong phiên bản hiện tại."),
  GOOGLE_CONSENT_CANCELLED: recovery("Chưa cấp quyền Google Directory", "Bạn đã hủy cấp quyền đọc Google Directory nên UPTECH chưa thể xác minh tổ chức."),
  DIRECTORY_SCOPE_REQUIRED: recovery("Chưa đủ quyền đọc Directory", "UPTECH chưa được cấp đủ quyền chỉ-đọc cần thiết để xác minh tổ chức."),
  CONSENT_ACCOUNT_MISMATCH: recovery("Tài khoản cấp quyền không khớp", "Tài khoản cấp quyền khác với tài khoản bắt đầu thiết lập."),
  DOMAIN_NOT_VERIFIED: recovery("Domain chưa được xác minh", "Domain công ty chưa được xác minh trong Google Workspace."),
  GOOGLE_ORGANIZATION_MISMATCH: recovery("Tổ chức Google Workspace không khớp", "Tài khoản và domain không thuộc cùng một tổ chức Google Workspace."),
  ORGANIZATION_ALREADY_REGISTERED: recovery("Tổ chức đã được thiết lập", "Tổ chức này đã được thiết lập trên UPTECH."),
  ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE: recovery("Tài khoản chưa có quyền", "Tổ chức này đã được thiết lập trên UPTECH nhưng tài khoản của bạn chưa có quyền."),
  DIRECTORY_BOOTSTRAP_SYNC_PENDING: recovery("Đang đồng bộ danh bạ", "Tổ chức đã được thiết lập và danh bạ Google Workspace đang được đồng bộ."),
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: recovery("Đồng bộ chưa hoàn tất", "Lần đồng bộ danh bạ chưa hoàn tất và có thể thử lại an toàn."),
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: recovery("Đồng bộ cần được hỗ trợ", "Đồng bộ danh bạ đã hết số lần thử an toàn và cần UPTECH kiểm tra."),
  USER_NOT_PROVISIONED: recovery("Bạn chưa được cấp quyền", "Công ty đã được nhận diện nhưng Admin chưa cấp phòng ban hoặc quyền truy cập cho bạn."),
  ACCESS_MAPPING_CONFLICT: recovery("Cấu hình quyền chưa nhất quán", "Quyền hoặc phòng ban của bạn đang được cấu hình không nhất quán."),
  USER_SUSPENDED: recovery("Tài khoản đang bị tạm khóa", "Tài khoản Google Workspace của bạn đang bị tạm khóa."),
  USER_REMOVED: recovery("Tài khoản không còn hoạt động", "Tài khoản không còn hoạt động trong Google Workspace của công ty."),
  DIRECTORY_SYNC_PENDING: recovery("Danh bạ đang được thiết lập", "Danh bạ công ty đang được Admin thiết lập nên UPTECH chưa thể xác nhận quyền của bạn."),
  DIRECTORY_STALE: recovery("Dữ liệu tổ chức chưa cập nhật", "UPTECH chưa thể xác nhận quyền hiện tại vì dữ liệu tổ chức chưa được cập nhật."),
  DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE: recovery("Dữ liệu tổ chức chưa cập nhật", "UPTECH chưa thể xác nhận quyền hiện tại vì dữ liệu tổ chức chưa được cập nhật."),
  WORKSPACE_SUSPENDED: recovery("Không gian làm việc tạm ngừng", "Không gian làm việc của công ty đang tạm ngừng hoạt động."),
  SESSION_REVOKED: recovery("Phiên đăng nhập hết hiệu lực", "Phiên đăng nhập đã hết hiệu lực hoặc quyền của bạn vừa thay đổi."),
  SESSION_EXPIRED: recovery("Phiên đăng nhập hết hiệu lực", "Phiên đăng nhập đã hết hiệu lực hoặc quyền của bạn vừa thay đổi."),
  ONBOARDING_EXPIRED: recovery("Phiên thiết lập hết hạn", "Phiên thiết lập đã hết hạn hoặc đã được sử dụng."),
  PROVIDER_UNAVAILABLE: recovery("Chưa thể xác minh quyền", "Hiện chưa thể xác minh quyền với Google; không có quyền truy cập nào được cấp."),
  RATE_LIMITED: recovery("Vui lòng thử lại sau", "Bạn đã thử quá nhiều lần; UPTECH tạm dừng yêu cầu để bảo vệ tài khoản."),
  FORBIDDEN: recovery("Không có quyền truy cập", "Tài khoản không có quyền truy cập không gian làm việc được yêu cầu."),
  INTERNAL_ERROR: recovery("Không thể hoàn tất yêu cầu", "Không thể hoàn tất yêu cầu; hãy cung cấp mã yêu cầu cho bộ phận hỗ trợ."),
} satisfies Readonly<Record<RecoveryState, LoginRecoverySurfaceCopy>>);

const EN_RECOVERY_COPY = Object.freeze({
  PERSONAL_GOOGLE_ACCOUNT: recovery("A business account is required", "UPTECH supports only business Google Workspace accounts."),
  UNKNOWN_WORKSPACE: recovery("Organization not set up", "Google verified the business account, but the organization has not been set up on UPTECH."),
  SUPER_ADMIN_REQUIRED: recovery("Super Admin required", "The account belongs to the company but does not have Google Workspace Super Admin authority to set up the organization."),
  DELEGATED_ADMIN_UNSUPPORTED: recovery("Super Admin required", "Delegated administrator authority is not sufficient to set up an organization in this version."),
  GOOGLE_CONSENT_CANCELLED: recovery("Google Directory access not granted", "You cancelled Google Directory read access, so UPTECH cannot yet verify the organization."),
  DIRECTORY_SCOPE_REQUIRED: recovery("Directory read access required", "UPTECH has not been granted all required read-only permissions to verify the organization."),
  CONSENT_ACCOUNT_MISMATCH: recovery("Authorization account mismatch", "The account granting access differs from the account that started setup."),
  DOMAIN_NOT_VERIFIED: recovery("Domain not verified", "The company domain has not been verified in Google Workspace."),
  GOOGLE_ORGANIZATION_MISMATCH: recovery("Google Workspace organization mismatch", "The account and domain do not belong to the same Google Workspace organization."),
  ORGANIZATION_ALREADY_REGISTERED: recovery("Organization already set up", "This organization has already been set up on UPTECH."),
  ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE: recovery("Access not granted", "This organization has already been set up on UPTECH, but your account does not have access."),
  DIRECTORY_BOOTSTRAP_SYNC_PENDING: recovery("Directory sync in progress", "The organization is set up and its Google Workspace directory is being synchronized."),
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: recovery("Directory sync incomplete", "The directory sync did not finish and can be retried safely."),
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: recovery("Directory sync needs support", "The directory sync exhausted its safe retry limit and needs UPTECH to investigate."),
  USER_NOT_PROVISIONED: recovery("Access not granted", "The company was identified, but an Admin has not assigned your department or access."),
  ACCESS_MAPPING_CONFLICT: recovery("Access configuration conflict", "Your access or department configuration is inconsistent."),
  USER_SUSPENDED: recovery("Account suspended", "Your Google Workspace account is suspended."),
  USER_REMOVED: recovery("Account no longer active", "The account is no longer active in the company's Google Workspace."),
  DIRECTORY_SYNC_PENDING: recovery("Directory setup in progress", "A company Admin is setting up the directory, so UPTECH cannot yet confirm your access."),
  DIRECTORY_STALE: recovery("Organization data is out of date", "UPTECH cannot confirm your current access because the organization data has not been updated."),
  DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE: recovery("Organization data is out of date", "UPTECH cannot confirm your current access because the organization data has not been updated."),
  WORKSPACE_SUSPENDED: recovery("Workspace suspended", "The company's workspace is temporarily suspended."),
  SESSION_REVOKED: recovery("Session no longer valid", "The sign-in session is no longer valid, or your access has just changed."),
  SESSION_EXPIRED: recovery("Session no longer valid", "The sign-in session is no longer valid, or your access has just changed."),
  ONBOARDING_EXPIRED: recovery("Setup session expired", "The setup session has expired or has already been used."),
  PROVIDER_UNAVAILABLE: recovery("Access cannot be verified", "Access cannot currently be verified with Google; no access has been granted."),
  RATE_LIMITED: recovery("Please try again later", "You tried too many times; UPTECH paused requests to protect your account."),
  FORBIDDEN: recovery("Access denied", "The account does not have access to the requested workspace."),
  INTERNAL_ERROR: recovery("Unable to complete the request", "The request could not be completed; provide the request ID to support."),
} satisfies Readonly<Record<RecoveryState, LoginRecoverySurfaceCopy>>);

export const LOGIN_RECOVERY_COPY_BY_LOCALE = Object.freeze({
  vi: Object.freeze({
    normal: Object.freeze({
      title: "Đăng nhập vào workspace",
      description: "Sử dụng tài khoản Google Workspace do tổ chức của bạn cấp.",
      isError: false,
    }),
    states: VI_RECOVERY_COPY,
    shell: Object.freeze({
      home: "Trang chủ",
      homeAriaLabel: "UPTECH KNOWLEDGE - Trang chủ",
      requestIdLabel: "Mã yêu cầu",
      redirectingLabel: "Đang chuyển đến Google…",
    }),
  }),
  en: Object.freeze({
    normal: Object.freeze({
      title: "Sign in to your workspace",
      description: "Use your Workspace account.",
      isError: false,
    }),
    states: EN_RECOVERY_COPY,
    shell: Object.freeze({
      home: "Home",
      homeAriaLabel: "UPTECH KNOWLEDGE - Home",
      requestIdLabel: "Request ID",
      redirectingLabel: "Redirecting to Google…",
    }),
  }),
} satisfies Readonly<Record<Locale, LoginRecoveryLocaleCopy>>);

export function resolveLoginRecoveryCopy(locale: unknown, state: unknown): LoginRecoverySurfaceCopy | null {
  if (locale !== "vi" && locale !== "en") return null;
  if (state === null) return LOGIN_RECOVERY_COPY_BY_LOCALE[locale].normal;
  if (typeof state !== "string" || !Object.hasOwn(LOGIN_RECOVERY_COPY_BY_LOCALE[locale].states, state)) return null;
  return LOGIN_RECOVERY_COPY_BY_LOCALE[locale].states[state as RecoveryState];
}
