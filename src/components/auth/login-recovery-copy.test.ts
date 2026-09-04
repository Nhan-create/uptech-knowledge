import assert from "node:assert/strict";
import test from "node:test";

import {
  LOGIN_RECOVERY_COPY_BY_LOCALE,
  resolveLoginRecoveryCopy,
} from "./login-recovery-copy.ts";
import { RECOVERY_STATES } from "../../server/auth/recovery-actions.ts";

const VI_DESCRIPTIONS = {
  PERSONAL_GOOGLE_ACCOUNT: "UPTECH chỉ hỗ trợ tài khoản Google Workspace của doanh nghiệp.",
  UNKNOWN_WORKSPACE: "Tài khoản công ty đã được Google xác minh, nhưng tổ chức chưa được thiết lập trên UPTECH.",
  SUPER_ADMIN_REQUIRED: "Tài khoản thuộc công ty nhưng không có quyền Google Workspace Super Admin để thiết lập tổ chức.",
  DELEGATED_ADMIN_UNSUPPORTED: "Quyền quản trị được ủy quyền chưa đủ để thiết lập tổ chức trong phiên bản hiện tại.",
  GOOGLE_CONSENT_CANCELLED: "Bạn đã hủy cấp quyền đọc Google Directory nên UPTECH chưa thể xác minh tổ chức.",
  DIRECTORY_SCOPE_REQUIRED: "UPTECH chưa được cấp đủ quyền chỉ-đọc cần thiết để xác minh tổ chức.",
  CONSENT_ACCOUNT_MISMATCH: "Tài khoản cấp quyền khác với tài khoản bắt đầu thiết lập.",
  DOMAIN_NOT_VERIFIED: "Domain công ty chưa được xác minh trong Google Workspace.",
  GOOGLE_ORGANIZATION_MISMATCH: "Tài khoản và domain không thuộc cùng một tổ chức Google Workspace.",
  ORGANIZATION_ALREADY_REGISTERED: "Tổ chức này đã được thiết lập trên UPTECH.",
  ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE: "Tổ chức này đã được thiết lập trên UPTECH nhưng tài khoản của bạn chưa có quyền.",
  DIRECTORY_BOOTSTRAP_SYNC_PENDING: "Tổ chức đã được thiết lập và danh bạ Google Workspace đang được đồng bộ.",
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: "Lần đồng bộ danh bạ chưa hoàn tất và có thể thử lại an toàn.",
  DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: "Đồng bộ danh bạ đã hết số lần thử an toàn và cần UPTECH kiểm tra.",
  USER_NOT_PROVISIONED: "Công ty đã được nhận diện nhưng Admin chưa cấp phòng ban hoặc quyền truy cập cho bạn.",
  ACCESS_MAPPING_CONFLICT: "Quyền hoặc phòng ban của bạn đang được cấu hình không nhất quán.",
  USER_SUSPENDED: "Tài khoản Google Workspace của bạn đang bị tạm khóa.",
  USER_REMOVED: "Tài khoản không còn hoạt động trong Google Workspace của công ty.",
  DIRECTORY_SYNC_PENDING: "Danh bạ công ty đang được Admin thiết lập nên UPTECH chưa thể xác nhận quyền của bạn.",
  DIRECTORY_STALE: "UPTECH chưa thể xác nhận quyền hiện tại vì dữ liệu tổ chức chưa được cập nhật.",
  DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE: "UPTECH chưa thể xác nhận quyền hiện tại vì dữ liệu tổ chức chưa được cập nhật.",
  WORKSPACE_SUSPENDED: "Không gian làm việc của công ty đang tạm ngừng hoạt động.",
  SESSION_REVOKED: "Phiên đăng nhập đã hết hiệu lực hoặc quyền của bạn vừa thay đổi.",
  SESSION_EXPIRED: "Phiên đăng nhập đã hết hiệu lực hoặc quyền của bạn vừa thay đổi.",
  ONBOARDING_EXPIRED: "Phiên thiết lập đã hết hạn hoặc đã được sử dụng.",
  PROVIDER_UNAVAILABLE: "Hiện chưa thể xác minh quyền với Google; không có quyền truy cập nào được cấp.",
  RATE_LIMITED: "Bạn đã thử quá nhiều lần; UPTECH tạm dừng yêu cầu để bảo vệ tài khoản.",
  FORBIDDEN: "Tài khoản không có quyền truy cập không gian làm việc được yêu cầu.",
  INTERNAL_ERROR: "Không thể hoàn tất yêu cầu; hãy cung cấp mã yêu cầu cho bộ phận hỗ trợ.",
} as const;

test("copy tables cover exactly every closed recovery state", () => {
  const expected = [...RECOVERY_STATES].sort();
  assert.deepEqual(Object.keys(LOGIN_RECOVERY_COPY_BY_LOCALE.vi.states).sort(), expected);
  assert.deepEqual(Object.keys(LOGIN_RECOVERY_COPY_BY_LOCALE.en.states).sort(), expected);
});

test("Vietnamese descriptions preserve every approved user-level reason", () => {
  for (const state of RECOVERY_STATES) {
    assert.equal(LOGIN_RECOVERY_COPY_BY_LOCALE.vi.states[state].description, VI_DESCRIPTIONS[state], state);
  }
});

test("English recovery copy is fixed, bounded, and faithful at representative causes", () => {
  assert.equal(LOGIN_RECOVERY_COPY_BY_LOCALE.en.states.PERSONAL_GOOGLE_ACCOUNT.description,
    "UPTECH supports only business Google Workspace accounts.");
  assert.equal(LOGIN_RECOVERY_COPY_BY_LOCALE.en.states.SUPER_ADMIN_REQUIRED.description,
    "The account belongs to the company but does not have Google Workspace Super Admin authority to set up the organization.");
  assert.equal(LOGIN_RECOVERY_COPY_BY_LOCALE.en.states.SESSION_EXPIRED.description,
    "The sign-in session is no longer valid, or your access has just changed.");
  for (const state of RECOVERY_STATES) {
    const copy = LOGIN_RECOVERY_COPY_BY_LOCALE.en.states[state];
    assert.ok(copy.title.length > 0 && copy.title.length <= 80, state);
    assert.ok(copy.description.length > 0 && copy.description.length <= 180, state);
  }
});

test("normal login and fixed shell copy remain compatible", () => {
  assert.deepEqual(LOGIN_RECOVERY_COPY_BY_LOCALE.vi.normal, {
    title: "Đăng nhập vào workspace",
    description: "Sử dụng tài khoản Google Workspace do tổ chức của bạn cấp.",
    isError: false,
  });
  assert.deepEqual(LOGIN_RECOVERY_COPY_BY_LOCALE.en.normal, {
    title: "Sign in to your workspace",
    description: "Use your Workspace account.",
    isError: false,
  });
  assert.deepEqual(LOGIN_RECOVERY_COPY_BY_LOCALE.vi.shell, {
    home: "Trang chủ", homeAriaLabel: "UPTECH KNOWLEDGE - Trang chủ",
    requestIdLabel: "Mã yêu cầu", redirectingLabel: "Đang chuyển đến Google…",
  });
  assert.deepEqual(LOGIN_RECOVERY_COPY_BY_LOCALE.en.shell, {
    home: "Home", homeAriaLabel: "UPTECH KNOWLEDGE - Home",
    requestIdLabel: "Request ID", redirectingLabel: "Redirecting to Google…",
  });
});

test("published copy is deeply immutable, serializable plain text without embedded data", () => {
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(LOGIN_RECOVERY_COPY_BY_LOCALE)));
  for (const locale of ["vi", "en"] as const) {
    assert.ok(Object.isFrozen(LOGIN_RECOVERY_COPY_BY_LOCALE[locale]));
    assert.ok(Object.isFrozen(LOGIN_RECOVERY_COPY_BY_LOCALE[locale].states));
    for (const state of RECOVERY_STATES) {
      const copy = LOGIN_RECOVERY_COPY_BY_LOCALE[locale].states[state];
      assert.ok(Object.isFrozen(copy), `${locale}:${state}`);
      for (const value of [copy.title, copy.description]) {
        assert.doesNotMatch(value, /[<>\u0000-\u001f]|https?:\/\/|\.com\b|C\d{6,}|@[\w.-]+/iu);
      }
      assert.equal(copy.isError, true);
    }
  }
});

test("resolver selects normal only for null and rejects forged locale or state", () => {
  assert.equal(resolveLoginRecoveryCopy("vi", null), LOGIN_RECOVERY_COPY_BY_LOCALE.vi.normal);
  assert.equal(resolveLoginRecoveryCopy("en", "FORBIDDEN"), LOGIN_RECOVERY_COPY_BY_LOCALE.en.states.FORBIDDEN);
  assert.equal(resolveLoginRecoveryCopy("vi", "<script>"), null);
  assert.equal(resolveLoginRecoveryCopy("fr", "INTERNAL_ERROR"), null);
  assert.equal(resolveLoginRecoveryCopy("vi", undefined), null);
});
