import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const baseUrl = process.env.LOGIN_TEST_BASE_URL;
const provisioningPagePath = new URL("../src/app/setup/provisioning/page.tsx", import.meta.url);
const enterpriseHelpPagePath = new URL("../src/app/help/enterprise-login/page.tsx", import.meta.url);
const domainHelpPagePath = new URL("../src/app/help/google-workspace/domain-verification/page.tsx", import.meta.url);
const appOrigin = expectedAppOrigin();
const requestId = "00000000-0000-4000-8000-000000000091";

function expectedAppOrigin() {
  const configured = process.env.LOGIN_TEST_APP_ORIGIN;
  if (configured === undefined) {
    return baseUrl === undefined ? undefined : new URL(baseUrl).origin;
  }

  const parsed = new URL(configured);
  assert.equal(parsed.protocol, "https:", "LOGIN_TEST_APP_ORIGIN must use HTTPS");
  assert.equal(parsed.username, "", "LOGIN_TEST_APP_ORIGIN must not contain credentials");
  assert.equal(parsed.password, "", "LOGIN_TEST_APP_ORIGIN must not contain credentials");
  assert.equal(parsed.pathname, "/", "LOGIN_TEST_APP_ORIGIN must be an origin");
  assert.equal(parsed.search, "", "LOGIN_TEST_APP_ORIGIN must be an origin");
  assert.equal(parsed.hash, "", "LOGIN_TEST_APP_ORIGIN must be an origin");
  return parsed.origin;
}

test("provisioning page is a headers-only fail-closed surface with server-selected actions", () => {
  assert.equal(existsSync(provisioningPagePath), true, "the provisioning-only page must exist");
  if (!existsSync(provisioningPagePath)) return;

  const source = readFileSync(provisioningPagePath, "utf8");
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?googleBot:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?noimageindex:\s*true/);
  assert.match(source, /export default async function ProvisioningPage\(\)/);
  assert.match(source, /resolveProvisioningPageModel\(new Headers\(await headers\(\)\)\)/);
  assert.match(source, /if \(model\.kind === "REDIRECT"\)\s*\{\s*redirect\(model\.destination\);\s*\}/);
  assert.equal((source.match(/<LoginRecoveryActions\b/gu) ?? []).length, 1);
  assert.match(source, /state=\{model\.kind === "RENDER" && model\.state !== "READY" \? model\.state : null\}/);
  assert.match(source, /actions=\{model\.actions\}/);
  assert.match(source, /csrfToken=\{model\.kind === "RENDER" \? model\.csrfToken : null\}/);
  assert.match(source, /requestId=\{model\.requestId\}/);
  assert.match(source, /retryAfterSeconds=\{null\}/);

  assert.doesNotMatch(source, /searchParams|useSearchParams|URLSearchParams|dangerouslySetInnerHTML|\bwindow\b|\bfetch\s*\(/);
  assert.doesNotMatch(source, /href=|<form\b|action=|\/admin\b|\/home\b/);
  assert.doesNotMatch(source, /customerId|workspaceId|tenantId|providerError|generationId|groupName|departmentName|orgUnit/);
});

test("enterprise help pages are cookie-localized static server surfaces without authority inputs", () => {
  for (const pagePath of [enterpriseHelpPagePath, domainHelpPagePath]) {
    assert.equal(existsSync(pagePath), true, `missing help page: ${pagePath.pathname}`);
    if (!existsSync(pagePath)) continue;

    const source = readFileSync(pagePath, "utf8");
    assert.match(source, /import \{ cookies \} from "next\/headers"/);
    assert.match(source, /import \{ LOCALE_COOKIE_NAME, parseLocale, type Locale \} from "@\/lib\/preferences"/);
    assert.match(source, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?googleBot:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?noimageindex:\s*true/);
    assert.match(source, /const cookieStore = await cookies\(\)/);
    assert.match(source, /parseLocale\(cookieStore\.get\(LOCALE_COOKIE_NAME\)\?\.value\)/);
    assert.doesNotMatch(source, /"use client"|'use client'|searchParams|useSearchParams|URLSearchParams|\bheaders\s*\(|dangerouslySetInnerHTML|\bfetch\s*\(|\bwindow\b|\bdocument\b/);
    assert.doesNotMatch(source, /<form\b|<input\b|<button\b|action=|method=|@\/server|database|auth\/runtime|PublicNav/);
    assert.doesNotMatch(source, /href="\/(?:admin|home|san-pham|nguyen-tac|nang-luc|quy-trinh)\b/);
    assert.doesNotMatch(source, /customerId|workspaceId|tenantId|providerSubject|generationId|groupName|departmentName|orgUnit|providerError/);
  }
});

test("help page link authority is a literal closed allowlist", () => {
  const enterprise = readFileSync(enterpriseHelpPagePath, "utf8");
  const domain = readFileSync(domainHelpPagePath, "utf8");
  const hrefs = (source) => [...source.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]).sort();

  assert.deepEqual(hrefs(enterprise), ["/login"]);
  assert.deepEqual(hrefs(domain), ["/login", "https://admin.google.com/ac/domains/manage"]);
  assert.match(
    domain,
    /<a(?=[^>]*href="https:\/\/admin\.google\.com\/ac\/domains\/manage")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")(?=[^>]*referrerPolicy="no-referrer")[^>]*>/,
  );
});

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
  assert.equal(location.origin, appOrigin);
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

function assertNativeIntentForm(html, intent) {
  assert.match(
    renderedMain(html),
    new RegExp(`<form(?=[^>]*action="/api/v1/auth/google/transactions")(?=[^>]*method="post")[^>]*>\\s*<input(?=[^>]*type="hidden")(?=[^>]*name="intent")(?=[^>]*value="${intent}")[^>]*/>`),
  );
}

function assertVietnameseContactControl(html, label, state) {
  const match = renderedMain(html).match(new RegExp(`<a[^>]+href="([^"]+)"[^>]*>${label}</a>`));
  assert.notEqual(match, null, `${label} must be an executable contact link`);
  const contact = new URL(match[1].replaceAll("&amp;", "&"));
  assert.equal(contact.protocol, "mailto:");
  assert.equal(contact.pathname, "contact@uptech.vn");
  assert.equal(contact.searchParams.get("subject"), "Hỗ trợ đăng nhập UPTECH");
  assert.equal(
    contact.searchParams.get("body"),
    `Tôi cần hỗ trợ về đăng nhập doanh nghiệp.\nTrạng thái: ${state}`,
  );
}

test("unknown organizations explain the verified company account and expose only an executable account switch without capability", async (context) => {
  const html = await loginHtml("/login?error=unknown_workspace", context);
  if (html === undefined) return;

  const main = renderedMain(html);
  assert.match(main, />Tổ chức chưa được thiết lập</);
  assert.match(
    main,
    /Tài khoản công ty đã được Google xác minh, nhưng tổ chức chưa được thiết lập trên UPTECH\./,
  );
  assert.match(main, />Đổi tài khoản Google</);
  assertNativeIntentForm(main, "SWITCH_ACCOUNT");
  assert.doesNotMatch(main, /\/api\/v1\/onboarding\/google-workspace\/transactions/);
  assert.doesNotMatch(main, /\/api\/v1\/onboarding\/(?:access-requests|google-workspace\/(?:status|sync-retry))/);
});

test("personal Google accounts are told to use their organization-provided Workspace account", async (context) => {
  const html = await loginHtml("/login?error=personal_account", context);
  if (html === undefined) return;

  assert.match(
    html,
    /UPTECH chỉ hỗ trợ tài khoản Google Workspace của doanh nghiệp\./,
  );
  assertNativeIntentForm(html, "SWITCH_ACCOUNT");
  assert.match(renderedMain(html), /href="\/help\/enterprise-login"[^>]*>Xem trợ giúp đăng nhập<\/a>/);
});

test("user and workspace suspensions have distinct recovery guidance", async (context) => {
  const userHtml = await loginHtml("/login?error=user_suspended", context);
  if (userHtml === undefined) return;
  const workspaceHtml = await loginHtml("/login?error=workspace_suspended", context);
  if (workspaceHtml === undefined) return;

  assert.match(userHtml, />Tài khoản đang bị tạm khóa</);
  assert.match(userHtml, /Tài khoản Google Workspace của bạn đang bị tạm khóa\./);
  assertNativeIntentForm(userHtml, "SWITCH_ACCOUNT");
  assert.match(renderedMain(userHtml), /<button[^>]+type="button"[^>]*>Sao chép hướng dẫn quản trị viên Workspace<\/button>/);

  assert.match(workspaceHtml, />Không gian làm việc tạm ngừng</);
  assert.match(workspaceHtml, /Không gian làm việc của công ty đang tạm ngừng hoạt động\./);
  assertVietnameseContactControl(workspaceHtml, "Liên hệ Uptech", "WORKSPACE_SUSPENDED");
  assertNativeIntentForm(workspaceHtml, "SWITCH_ACCOUNT");
  assert.doesNotMatch(userHtml, />Không gian làm việc tạm ngừng</);
  assert.doesNotMatch(workspaceHtml, />Tài khoản đang bị tạm khóa</);
});

test("login gives actionable, safe feedback for cancelled, expired, unavailable, and generic outcomes", async (context) => {
  const scenarios = [
    {
      error: "provider_rejected",
      title: "Không thể hoàn tất yêu cầu",
      description: "Không thể hoàn tất yêu cầu; hãy cung cấp mã yêu cầu cho bộ phận hỗ trợ.",
      intent: "LOGIN",
    },
    {
      error: "session_expired",
      title: "Phiên đăng nhập hết hiệu lực",
      description: "Phiên đăng nhập đã hết hiệu lực hoặc quyền của bạn vừa thay đổi.",
      intent: "LOGIN",
    },
    {
      error: "temporarily_unavailable",
      title: "Chưa thể xác minh quyền",
      description: "Hiện chưa thể xác minh quyền với Google; không có quyền truy cập nào được cấp.",
      intent: "LOGIN",
    },
    {
      error: "login_failed",
      title: "Không thể hoàn tất yêu cầu",
      description: "Không thể hoàn tất yêu cầu; hãy cung cấp mã yêu cầu cho bộ phận hỗ trợ.",
      intent: "LOGIN",
    },
  ];

  for (const scenario of scenarios) {
    const html = await loginHtml(`/login?error=${scenario.error}`, context);
    if (html === undefined) return;
    assert.match(html, new RegExp(`>${scenario.title}<`));
    assert.match(html, new RegExp(scenario.description.replaceAll(".", "\\.")));
    assertNativeIntentForm(html, scenario.intent);
  }

  const unavailableHtml = await loginHtml("/login?error=temporarily_unavailable", context);
  if (unavailableHtml === undefined) return;
  assertVietnameseContactControl(unavailableHtml, "Liên hệ Uptech", "PROVIDER_UNAVAILABLE");
});

test("only a valid request ID is displayed on the login error state", async (context) => {
  const validHtml = await loginHtml(
    `/login?error=login_failed&request_id=${requestId}`,
    context,
  );
  if (validHtml === undefined) return;
  const validMain = renderedMain(validHtml);
  assert.match(validMain, new RegExp(requestId));
  assert.match(validMain, /<button[^>]+type="button"[^>]*>Sao chép mã yêu cầu<\/button>/);

  const unsafeRequestId = "untrusted-request-id";
  const unsafeHtml = await loginHtml(
    `/login?error=login_failed&request_id=${unsafeRequestId}`,
    context,
  );
  if (unsafeHtml === undefined) return;
  assert.doesNotMatch(renderedMain(unsafeHtml), new RegExp(unsafeRequestId));
});

test("login never reflects or trusts browser-supplied account, domain, action, or return URL", async (context) => {
  const html = await loginHtml(
    `/login?error=login_failed&account=person@unknown.example&domain=tenant-b.example&action=START_ORGANIZATION_SETUP&returnUrl=${encodeURIComponent("https://tenant-b.example/takeover")}`,
    context,
  );
  if (html === undefined) return;

  const main = renderedMain(html);
  assert.doesNotMatch(main, /person@unknown\.example/);
  assert.doesNotMatch(main, /tenant-b\.example|START_ORGANIZATION_SETUP|takeover/);
  assertNativeIntentForm(main, "LOGIN");
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
    new URL("/api/v1/auth/google/callback", appOrigin).href,
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
  const location = new URL(response.headers.get("location"), appOrigin);
  assert.equal(location.origin, appOrigin);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("error"), "session_expired");
});
