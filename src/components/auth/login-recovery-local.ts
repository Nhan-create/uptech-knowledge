import { RECOVERY_STATES, type RecoveryState } from "../../server/auth/recovery-actions.ts";

export const MAX_RECOVERY_JSON_CHARS = 2048;

export type RecoveryLocale = "vi" | "en";
export type RecoveryClipboardTemplate = "SUPER_ADMIN_SETUP_V1" | "WORKSPACE_ACCESS_V1" | "REQUEST_ID_V1";
export type LoginRecoveryFeedbackKind =
  | "WORKING"
  | "ACTION_FAILURE"
  | "CLIPBOARD_SUCCESS"
  | "CLIPBOARD_MANUAL"
  | "ACCESS_REQUEST_RECEIPT"
  | "COOLDOWN";

const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECOVERY_STATE_SET = new Set<string>(RECOVERY_STATES);
const MAX_COOLDOWN_SECONDS_EXCLUSIVE = 300;

function localeOf(value: unknown): RecoveryLocale | null {
  return value === "vi" || value === "en" ? value : null;
}

function requestIdOf(value: unknown): string | null {
  return typeof value === "string" && CANONICAL_UUID_V4.test(value) ? value : null;
}

function stateOf(value: unknown): RecoveryState | null {
  return typeof value === "string" && RECOVERY_STATE_SET.has(value) ? value as RecoveryState : null;
}

export function parseBoundedRecoveryJson(text: unknown): unknown | null {
  if (typeof text !== "string" || text.length > MAX_RECOVERY_JSON_CHARS) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function readBoundedRecoveryJson(response: Pick<Response, "body">): Promise<unknown | null> {
  if (response.body === null) return null;

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let cancel = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RECOVERY_JSON_CHARS) {
        cancel = true;
        return null;
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = parseBoundedRecoveryJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    cancel = parsed === null;
    return parsed;
  } catch {
    cancel = true;
    return null;
  } finally {
    if (cancel) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be errored or closed.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Releasing an already-invalid reader must not escape the fixed failure path.
    }
  }
}

export function resolveRecoveryClipboardText(input: Readonly<{
  template: unknown;
  locale: unknown;
  requestId: unknown;
}>): string | null {
  const locale = localeOf(input.locale);
  if (locale === null) return null;
  const requestId = requestIdOf(input.requestId);
  switch (input.template) {
    case "SUPER_ADMIN_SETUP_V1":
      return locale === "vi"
        ? "Hãy dùng tài khoản Google Workspace Super Admin của công ty để thực hiện thiết lập lần đầu."
        : "Use your company's Google Workspace Super Admin account to complete the first-time setup.";
    case "WORKSPACE_ACCESS_V1": {
      const base = locale === "vi"
        ? "Vui lòng liên hệ quản trị viên Google Workspace/UPTECH của công ty để được gán quyền và phòng ban."
        : "Contact your company's Google Workspace/UPTECH administrator for access and department mapping.";
      return requestId === null ? base : `${base} ${locale === "vi" ? "Mã yêu cầu" : "Request ID"}: ${requestId}`;
    }
    case "REQUEST_ID_V1":
      return requestId;
    default:
      return null;
  }
}

export function buildRecoveryContactHref(input: Readonly<{
  locale: unknown;
  state: unknown;
  requestId: unknown;
}>): string {
  const locale = localeOf(input.locale) ?? "en";
  const state = stateOf(input.state);
  const requestId = requestIdOf(input.requestId);
  const subject = locale === "vi" ? "Hỗ trợ đăng nhập UPTECH" : "UPTECH login support";
  const lines = [
    locale === "vi" ? "Tôi cần hỗ trợ về đăng nhập doanh nghiệp." : "I need help with enterprise login.",
    ...(state === null ? [] : [`${locale === "vi" ? "Trạng thái" : "State"}: ${state}`]),
    ...(requestId === null ? [] : [`${locale === "vi" ? "Mã yêu cầu" : "Request ID"}: ${requestId}`]),
  ];
  return `mailto:contact@uptech.vn?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export function getLoginRecoveryFeedback(input: Readonly<{
  locale: unknown;
  kind: unknown;
  requestId?: unknown;
  cooldownSeconds?: unknown;
}>): string | null {
  const locale = localeOf(input.locale);
  if (locale === null) return null;
  const requestId = requestIdOf(input.requestId);
  switch (input.kind as LoginRecoveryFeedbackKind) {
    case "WORKING":
      return locale === "vi" ? "Đang xử lý, vui lòng chờ…" : "Working, please wait…";
    case "ACTION_FAILURE": {
      const base = locale === "vi" ? "Không thể hoàn tất thao tác. Vui lòng thử lại." : "The action could not be completed. Please try again.";
      return requestId === null ? base : `${base} ${locale === "vi" ? "Mã yêu cầu" : "Request ID"}: ${requestId}`;
    }
    case "CLIPBOARD_SUCCESS":
      return locale === "vi" ? "Đã sao chép hướng dẫn." : "Instructions copied.";
    case "CLIPBOARD_MANUAL":
      return locale === "vi" ? "Không thể tự sao chép. Hãy chọn và sao chép nội dung bên dưới." : "Automatic copy is unavailable. Select and copy the text below.";
    case "ACCESS_REQUEST_RECEIPT": {
      const base = locale === "vi"
        ? "Yêu cầu truy cập đang chờ duyệt. Vui lòng liên hệ quản trị viên công ty."
        : "Your access request is pending. Contact your company administrator.";
      return requestId === null ? base : `${base} ${locale === "vi" ? "Mã yêu cầu" : "Request ID"}: ${requestId}`;
    }
    case "COOLDOWN": {
      const seconds = input.cooldownSeconds;
      if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds <= 0 || seconds >= MAX_COOLDOWN_SECONDS_EXCLUSIVE) return null;
      return locale === "vi" ? `Vui lòng thử lại sau ${seconds} giây.` : `Try again in ${seconds} seconds.`;
    }
    default:
      return null;
  }
}
