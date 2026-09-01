import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.LOGIN_TEST_BASE_URL;
const requestId = "00000000-0000-4000-8000-000000000091";

async function loginHtml(path, context) {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return undefined;
  }

  const response = await fetch(new URL(path, baseUrl));
  assert.equal(response.status, 200);
  return response.text();
}

function renderedMain(html) {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>", start);
  assert.notEqual(start, -1, "login response must render main content");
  assert.notEqual(end, -1, "login response must close main content");
  return html.slice(start, end + "</main>".length);
}

function assertLoginRedirect(response, expectedError) {
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, new URL(baseUrl).origin);
  assert.equal(location.pathname, "/login");
  assert.deepEqual([...location.searchParams.keys()].sort(), ["error", "request_id"]);
  assert.equal(location.searchParams.get("error"), expectedError);
  const redirectedRequestId = location.searchParams.get("request_id");
  assert.match(
    redirectedRequestId ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  assert.equal(response.headers.get("x-request-id"), redirectedRequestId);
}

test("unknown organizations receive the exact Vietnamese support guidance without an unavailable onboarding link", async (context) => {
  const html = await loginHtml("/login?error=unknown_workspace", context);
  if (html === undefined) return;

  assert.match(html, />Tổ chức của bạn chưa được đăng ký</);
  assert.match(
    html,
    /Tài khoản Google đã được xác minh, nhưng tổ chức của bạn chưa được thiết lập trên UPTECH KNOWLEDGE\./,
  );
  assert.match(
    html,
    /<a(?=[^>]*href="mailto:contact@uptech\.vn")[^>]*>Liên hệ UPTECH<\/a>/,
  );
  assert.match(html, />Đăng nhập bằng tài khoản khác</);
  assert.doesNotMatch(html, /href="\/onboarding(?:[\/?#]|\")/);
});

test("personal Google accounts are told to use their organization-provided Workspace account", async (context) => {
  const html = await loginHtml("/login?error=personal_account", context);
  if (html === undefined) return;

  assert.match(
    html,
    /Vui lòng sử dụng tài khoản Google Workspace do tổ chức của bạn cấp\./,
  );
  assert.match(html, />Đăng nhập bằng tài khoản khác</);
});

test("user and workspace suspensions have distinct recovery guidance", async (context) => {
  const userHtml = await loginHtml("/login?error=user_suspended", context);
  if (userHtml === undefined) return;
  const workspaceHtml = await loginHtml("/login?error=workspace_suspended", context);
  if (workspaceHtml === undefined) return;

  assert.match(userHtml, />Tài khoản đã bị tạm ngưng</);
  assert.match(userHtml, /liên hệ quản trị viên của tổ chức/i);
  assert.match(workspaceHtml, />Workspace đã bị tạm ngưng</);
  assert.match(workspaceHtml, /href="mailto:contact@uptech\.vn"/);
  assert.doesNotMatch(userHtml, />Workspace đã bị tạm ngưng</);
  assert.doesNotMatch(workspaceHtml, />Tài khoản đã bị tạm ngưng</);
});

test("login gives actionable, safe feedback for cancelled, expired, unavailable, and generic outcomes", async (context) => {
  const scenarios = [
    {
      error: "provider_rejected",
      title: "Đăng nhập đã bị hủy",
      description: "Bạn có thể thử lại bằng tài khoản Google Workspace khác.",
    },
    {
      error: "session_expired",
      title: "Phiên đăng nhập đã hết hạn",
      description: "Vui lòng đăng nhập lại để tiếp tục.",
    },
    {
      error: "temporarily_unavailable",
      title: "Tạm thời không thể đăng nhập",
      description: "Dịch vụ xác minh tài khoản đang tạm thời gián đoạn. Vui lòng thử lại.",
    },
    {
      error: "login_failed",
      title: "Không thể đăng nhập",
      description: "Đã xảy ra lỗi trong quá trình xác minh tài khoản. Vui lòng thử lại.",
    },
  ];

  for (const scenario of scenarios) {
    const html = await loginHtml(`/login?error=${scenario.error}`, context);
    if (html === undefined) return;
    assert.match(html, new RegExp(`>${scenario.title}<`));
    assert.match(html, new RegExp(scenario.description.replaceAll(".", "\\.")));
  }
});

test("only a valid request ID is displayed on the login error state", async (context) => {
  const validHtml = await loginHtml(
    `/login?error=login_failed&request_id=${requestId}`,
    context,
  );
  if (validHtml === undefined) return;
  assert.match(renderedMain(validHtml), new RegExp(requestId));

  const unsafeRequestId = "untrusted-request-id";
  const unsafeHtml = await loginHtml(
    `/login?error=login_failed&request_id=${unsafeRequestId}`,
    context,
  );
  if (unsafeHtml === undefined) return;
  assert.doesNotMatch(renderedMain(unsafeHtml), new RegExp(unsafeRequestId));
});

test("login never renders an account supplied by the browser query", async (context) => {
  const html = await loginHtml(
    "/login?error=login_failed&account=person@unknown.example",
    context,
  );
  if (html === undefined) return;

  assert.doesNotMatch(renderedMain(html), /person@unknown\.example/);
});

test("production begin-auth returns a real domain-neutral Google authorization request", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(
    new URL("/api/v1/auth/google/transactions", baseUrl),
    {
      method: "POST",
      headers: { "x-uptech-request-id": requestId },
      redirect: "manual",
    },
  );

  assert.equal(response.status, 303);
  const authorizationUrl = new URL(response.headers.get("location"));
  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(authorizationUrl.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("prompt"), "select_account");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    new URL("/api/v1/auth/google/callback", baseUrl).href,
  );
  assert.deepEqual(
    new Set(authorizationUrl.searchParams.get("scope")?.split(" ")),
    new Set(["openid", "email", "profile"]),
  );
  assert.equal(authorizationUrl.searchParams.has("hd"), false);
  assert.match(authorizationUrl.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{43}$/u);
  assert.match(authorizationUrl.searchParams.get("nonce") ?? "", /^[A-Za-z0-9_-]{43}$/u);
  assert.match(
    authorizationUrl.searchParams.get("code_challenge") ?? "",
    /^[A-Za-z0-9_-]{43}$/u,
  );
  const cookies = response.headers.getSetCookie?.() ?? [];
  assert.equal(cookies.some((cookie) => /__Host-uptech_login_tx=/u.test(cookie)), true);
  assert.equal(cookies.some((cookie) => /__Host-uptech_session=/u.test(cookie)), false);
});

test("failed callbacks return a safe login query and never establish a browser session", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(
    new URL("/api/v1/auth/google/callback?code=provider-code&state=untrusted", baseUrl),
    {
      headers: { "x-uptech-request-id": requestId },
      redirect: "manual",
    },
  );

  assertLoginRedirect(response, "login_failed");
  const cookies = response.headers.getSetCookie?.() ?? [];
  assert.equal(cookies.some((cookie) => /__Host-uptech_session=/u.test(cookie)), false);
});

test("an invalid protected-route session reaches the real session-expired state", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/home", baseUrl), {
    headers: {
      cookie: `__Host-uptech_session=${"A".repeat(43)}`,
    },
    redirect: "manual",
  });

  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"), baseUrl);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("error"), "session_expired");
});
