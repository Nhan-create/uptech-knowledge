export const RECOVERY_STATES = Object.freeze([
  "PERSONAL_GOOGLE_ACCOUNT", "UNKNOWN_WORKSPACE", "SUPER_ADMIN_REQUIRED", "DELEGATED_ADMIN_UNSUPPORTED",
  "GOOGLE_CONSENT_CANCELLED", "DIRECTORY_SCOPE_REQUIRED", "CONSENT_ACCOUNT_MISMATCH", "DOMAIN_NOT_VERIFIED",
  "GOOGLE_ORGANIZATION_MISMATCH", "ORGANIZATION_ALREADY_REGISTERED", "ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE",
  "DIRECTORY_BOOTSTRAP_SYNC_PENDING", "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
  "USER_NOT_PROVISIONED", "ACCESS_MAPPING_CONFLICT", "USER_SUSPENDED", "USER_REMOVED", "DIRECTORY_SYNC_PENDING",
  "DIRECTORY_STALE", "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE", "WORKSPACE_SUSPENDED", "SESSION_REVOKED", "SESSION_EXPIRED",
  "ONBOARDING_EXPIRED", "PROVIDER_UNAVAILABLE", "RATE_LIMITED", "FORBIDDEN", "INTERNAL_ERROR",
] as const);
export type RecoveryState = (typeof RECOVERY_STATES)[number];

export const PROVISIONING_PUBLIC_STATES = Object.freeze([
  "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
  "READY",
] as const);
export type ProvisioningPublicState = (typeof PROVISIONING_PUBLIC_STATES)[number];

export const RECOVERY_ACTION_IDS = Object.freeze([
  "START_NORMAL_LOGIN", "START_NORMAL_LOGIN_AFTER_COOLDOWN", "SWITCH_GOOGLE_ACCOUNT", "REGISTER_ORGANIZATION", "START_ORGANIZATION_SETUP",
  "RESTART_DIRECTORY_CONSENT", "CHECK_BOOTSTRAP_STATUS", "RETRY_DIRECTORY_SYNC", "FINISH_BOOTSTRAP", "EXIT_ONBOARDING",
  "SUBMIT_ACCESS_REQUEST", "OPEN_ENTERPRISE_LOGIN_HELP", "OPEN_DOMAIN_VERIFICATION_HELP", "COPY_SUPER_ADMIN_INSTRUCTIONS",
  "COPY_WORKSPACE_ADMIN_INSTRUCTIONS", "CONTACT_UPTECH", "COPY_REQUEST_ID",
] as const);
export type RecoveryActionId = (typeof RECOVERY_ACTION_IDS)[number];

export const RECOVERY_OPERATION_FAMILIES = Object.freeze({
  FIRST_DOMAIN: Object.freeze(["FIRST_DOMAIN_CLAIM_READ", "FIRST_DOMAIN_CLAIM_RESERVE", "FIRST_DOMAIN_CLAIM_COMPLETE"] as const),
  ACCESS_REQUEST: Object.freeze(["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"] as const),
  BOOTSTRAP_STATUS: Object.freeze(["DIRECTORY_BOOTSTRAP_STATUS_READ", "DIRECTORY_BOOTSTRAP_SYNC_RETRY"] as const),
});
export type RecoveryOperation = (typeof RECOVERY_OPERATION_FAMILIES)[keyof typeof RECOVERY_OPERATION_FAMILIES][number];
export const RECOVERY_AUTHORITY_KIND = "AUTHENTICATED_ONBOARDING" as const;
export interface RecoveryAuthority {
  readonly kind: typeof RECOVERY_AUTHORITY_KIND;
  readonly operations: readonly RecoveryOperation[];
}

type Label = Readonly<{ vi: string; en: string }>;
type RequestDescriptor = Readonly<{ id: RecoveryActionId; kind: "REQUEST"; method: "GET" | "POST"; path: string; label: Label }>;
type CopyDescriptor = Readonly<{ id: RecoveryActionId; kind: "COPY"; template: "SUPER_ADMIN_SETUP_V1" | "WORKSPACE_ACCESS_V1" | "REQUEST_ID_V1"; label: Label }>;
type ContactDescriptor = Readonly<{ id: "CONTACT_UPTECH"; kind: "CONTACT"; recipient: "contact@uptech.vn"; template: "CONTACT_UPTECH_PUBLIC_STATE_V1"; label: Label }>;
export type RecoveryActionDescriptor = RequestDescriptor | CopyDescriptor | ContactDescriptor;

function frozen<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object" && !Object.isFrozen(child)) frozen(child);
  }
  return Object.freeze(value);
}

const request = (id: RecoveryActionId, method: "GET" | "POST", path: string, vi: string, en: string): RequestDescriptor =>
  frozen({ id, kind: "REQUEST", method, path, label: { vi, en } });
const copy = (id: CopyDescriptor["id"], template: CopyDescriptor["template"], vi: string, en: string): CopyDescriptor =>
  frozen({ id, kind: "COPY", template, label: { vi, en } });

export const RECOVERY_ACTION_DESCRIPTORS = frozen({
  START_NORMAL_LOGIN: request("START_NORMAL_LOGIN", "POST", "/api/v1/auth/google/transactions", "Đăng nhập bằng Google", "Sign in with Google"),
  START_NORMAL_LOGIN_AFTER_COOLDOWN: request("START_NORMAL_LOGIN_AFTER_COOLDOWN", "POST", "/api/v1/auth/google/transactions", "Thử lại khi hết thời gian chờ", "Try again after cooldown"),
  SWITCH_GOOGLE_ACCOUNT: request("SWITCH_GOOGLE_ACCOUNT", "POST", "/api/v1/auth/google/transactions", "Đổi tài khoản Google", "Switch Google account"),
  REGISTER_ORGANIZATION: request("REGISTER_ORGANIZATION", "POST", "/api/v1/onboarding/google-workspace/transactions", "Đăng ký tổ chức mới", "Register new organization"),
  START_ORGANIZATION_SETUP: request("START_ORGANIZATION_SETUP", "POST", "/api/v1/onboarding/google-workspace/transactions", "Thiết lập tổ chức", "Set up organization"),
  RESTART_DIRECTORY_CONSENT: request("RESTART_DIRECTORY_CONSENT", "POST", "/api/v1/onboarding/google-workspace/transactions", "Kết nối lại Google Workspace", "Reconnect Google Workspace"),
  CHECK_BOOTSTRAP_STATUS: request("CHECK_BOOTSTRAP_STATUS", "GET", "/api/v1/onboarding/google-workspace/status", "Kiểm tra trạng thái", "Check status"),
  RETRY_DIRECTORY_SYNC: request("RETRY_DIRECTORY_SYNC", "POST", "/api/v1/onboarding/google-workspace/sync-retry", "Thử đồng bộ lại", "Retry directory sync"),
  FINISH_BOOTSTRAP: request("FINISH_BOOTSTRAP", "POST", "/api/v1/onboarding/google-workspace/finish", "Hoàn tất thiết lập", "Finish setup"),
  EXIT_ONBOARDING: request("EXIT_ONBOARDING", "POST", "/api/v1/onboarding/logout", "Thoát thiết lập", "Exit setup"),
  SUBMIT_ACCESS_REQUEST: request("SUBMIT_ACCESS_REQUEST", "POST", "/api/v1/onboarding/access-requests", "Gửi yêu cầu truy cập", "Submit access request"),
  OPEN_ENTERPRISE_LOGIN_HELP: request("OPEN_ENTERPRISE_LOGIN_HELP", "GET", "/help/enterprise-login", "Xem trợ giúp đăng nhập", "Open enterprise login help"),
  OPEN_DOMAIN_VERIFICATION_HELP: request("OPEN_DOMAIN_VERIFICATION_HELP", "GET", "/help/google-workspace/domain-verification", "Xem trợ giúp xác minh tên miền", "Open domain verification help"),
  COPY_SUPER_ADMIN_INSTRUCTIONS: copy("COPY_SUPER_ADMIN_INSTRUCTIONS", "SUPER_ADMIN_SETUP_V1", "Sao chép hướng dẫn Super Admin", "Copy Super Admin instructions"),
  COPY_WORKSPACE_ADMIN_INSTRUCTIONS: copy("COPY_WORKSPACE_ADMIN_INSTRUCTIONS", "WORKSPACE_ACCESS_V1", "Sao chép hướng dẫn quản trị viên Workspace", "Copy Workspace admin instructions"),
  CONTACT_UPTECH: frozen({ id: "CONTACT_UPTECH", kind: "CONTACT", recipient: "contact@uptech.vn", template: "CONTACT_UPTECH_PUBLIC_STATE_V1", label: { vi: "Liên hệ Uptech", en: "Contact Uptech" } } as const),
  COPY_REQUEST_ID: copy("COPY_REQUEST_ID", "REQUEST_ID_V1", "Sao chép mã yêu cầu", "Copy request ID"),
} satisfies Record<RecoveryActionId, RecoveryActionDescriptor>);

const STATE_ACTIONS: Readonly<Record<RecoveryState, readonly RecoveryActionId[]>> = frozen({
  PERSONAL_GOOGLE_ACCOUNT: ["SWITCH_GOOGLE_ACCOUNT", "OPEN_ENTERPRISE_LOGIN_HELP"], UNKNOWN_WORKSPACE: ["START_ORGANIZATION_SETUP", "SWITCH_GOOGLE_ACCOUNT"],
  SUPER_ADMIN_REQUIRED: ["SWITCH_GOOGLE_ACCOUNT", "COPY_SUPER_ADMIN_INSTRUCTIONS"], DELEGATED_ADMIN_UNSUPPORTED: ["SWITCH_GOOGLE_ACCOUNT", "COPY_SUPER_ADMIN_INSTRUCTIONS"],
  GOOGLE_CONSENT_CANCELLED: ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], DIRECTORY_SCOPE_REQUIRED: ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], CONSENT_ACCOUNT_MISMATCH: ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"],
  DOMAIN_NOT_VERIFIED: ["OPEN_DOMAIN_VERIFICATION_HELP", "SWITCH_GOOGLE_ACCOUNT"], GOOGLE_ORGANIZATION_MISMATCH: ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"], ORGANIZATION_ALREADY_REGISTERED: ["START_NORMAL_LOGIN", "CONTACT_UPTECH"],
  ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE: ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"], DIRECTORY_BOOTSTRAP_SYNC_PENDING: ["CHECK_BOOTSTRAP_STATUS", "EXIT_ONBOARDING"], DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: ["RETRY_DIRECTORY_SYNC", "CONTACT_UPTECH"], DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: ["CONTACT_UPTECH", "EXIT_ONBOARDING"],
  USER_NOT_PROVISIONED: ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"], ACCESS_MAPPING_CONFLICT: ["SUBMIT_ACCESS_REQUEST", "EXIT_ONBOARDING"], USER_SUSPENDED: ["SWITCH_GOOGLE_ACCOUNT", "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"], USER_REMOVED: ["SWITCH_GOOGLE_ACCOUNT", "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"], DIRECTORY_SYNC_PENDING: ["COPY_WORKSPACE_ADMIN_INSTRUCTIONS", "START_NORMAL_LOGIN"],
  DIRECTORY_STALE: ["CONTACT_UPTECH", "START_NORMAL_LOGIN"], DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE: ["SUBMIT_ACCESS_REQUEST", "START_NORMAL_LOGIN"], WORKSPACE_SUSPENDED: ["CONTACT_UPTECH", "SWITCH_GOOGLE_ACCOUNT"], SESSION_REVOKED: ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"], SESSION_EXPIRED: ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"],
  ONBOARDING_EXPIRED: ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], PROVIDER_UNAVAILABLE: ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], RATE_LIMITED: ["START_NORMAL_LOGIN_AFTER_COOLDOWN", "CONTACT_UPTECH"], FORBIDDEN: ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"], INTERNAL_ERROR: ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"],
});

const PROVISIONING_STATE_ACTIONS: Readonly<Record<ProvisioningPublicState, readonly RecoveryActionId[]>> = frozen({
  DIRECTORY_BOOTSTRAP_SYNC_PENDING: ["CHECK_BOOTSTRAP_STATUS", "EXIT_ONBOARDING"],
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: ["RETRY_DIRECTORY_SYNC", "CONTACT_UPTECH"],
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: ["CONTACT_UPTECH", "EXIT_ONBOARDING"],
  READY: ["FINISH_BOOTSTRAP", "EXIT_ONBOARDING"],
});

const REQUIRED_FAMILY: Readonly<Partial<Record<RecoveryActionId, keyof typeof RECOVERY_OPERATION_FAMILIES | "ONBOARDING">>> = Object.freeze({
  START_ORGANIZATION_SETUP: "FIRST_DOMAIN", RESTART_DIRECTORY_CONSENT: "FIRST_DOMAIN", SUBMIT_ACCESS_REQUEST: "ACCESS_REQUEST",
  CHECK_BOOTSTRAP_STATUS: "BOOTSTRAP_STATUS", RETRY_DIRECTORY_SYNC: "BOOTSTRAP_STATUS", FINISH_BOOTSTRAP: "BOOTSTRAP_STATUS", EXIT_ONBOARDING: "ONBOARDING",
});

function hasExactOperations(operations: unknown, expected: readonly RecoveryOperation[]): boolean {
  return Array.isArray(operations) && operations.length === expected.length && operations.every((operation, index) => operation === expected[index]);
}

function isAuthenticatedOnboardingAuthority(authority: unknown): authority is RecoveryAuthority {
  if (authority === null || typeof authority !== "object") return false;
  const candidate = authority as Readonly<{ kind?: unknown; operations?: unknown }>;
  return candidate.kind === RECOVERY_AUTHORITY_KIND && Object.values(RECOVERY_OPERATION_FAMILIES).some((family) => hasExactOperations(candidate.operations, family));
}

function hasExactFamily(authority: RecoveryAuthority | null, family: keyof typeof RECOVERY_OPERATION_FAMILIES): boolean {
  if (!isAuthenticatedOnboardingAuthority(authority)) return false;
  const expected = RECOVERY_OPERATION_FAMILIES[family];
  return hasExactOperations(authority.operations, expected);
}

function isExecutable(id: RecoveryActionId, authority: RecoveryAuthority | null): boolean {
  const requirement = REQUIRED_FAMILY[id];
  if (requirement === undefined) return true;
  if (requirement === "ONBOARDING") return isAuthenticatedOnboardingAuthority(authority);
  return hasExactFamily(authority, requirement);
}

export function resolveRecoveryActions(input: Readonly<{ state: RecoveryState; authority: RecoveryAuthority | null }>): readonly RecoveryActionDescriptor[] {
  const actions = STATE_ACTIONS[input.state].filter((id) => isExecutable(id, input.authority));
  const resolved = actions.length === 0 ? ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"] as const : actions;
  return Object.freeze(resolved.map((id) => RECOVERY_ACTION_DESCRIPTORS[id]));
}

export function resolveProvisioningActions(input: Readonly<{
  state: ProvisioningPublicState;
  authority: RecoveryAuthority | null;
}>): readonly RecoveryActionDescriptor[] {
  const actions = hasExactFamily(input.authority, "BOOTSTRAP_STATUS")
    ? PROVISIONING_STATE_ACTIONS[input.state]
    : PROVISIONING_STATE_ACTIONS[input.state].filter((id) => id === "CONTACT_UPTECH");
  const resolved = actions.length === 0 ? ["CONTACT_UPTECH"] as const : actions;
  return Object.freeze(resolved.map((id) => RECOVERY_ACTION_DESCRIPTORS[id]));
}
