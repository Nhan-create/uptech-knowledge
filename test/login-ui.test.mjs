import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const baseUrl = process.env.LOGIN_TEST_BASE_URL;
const provisioningPagePath = new URL("../src/app/setup/provisioning/page.tsx", import.meta.url);
const enterpriseHelpPagePath = new URL("../src/app/help/enterprise-login/page.tsx", import.meta.url);
const domainHelpPagePath = new URL("../src/app/help/google-workspace/domain-verification/page.tsx", import.meta.url);

function literalHrefs(source) {
  return [...source.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]).sort();
}

function mainMarkup(html) {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>", start);
  assert.notEqual(start, -1, "help response must render main content");
  assert.notEqual(end, -1, "help response must close main content");
  return html.slice(start, end + "</main>".length);
}

test("provisioning page presents every bounded setup state in Vietnamese and English", () => {
  assert.equal(existsSync(provisioningPagePath), true, "the provisioning-only page must exist");
  if (!existsSync(provisioningPagePath)) return;

  const source = readFileSync(provisioningPagePath, "utf8");
  for (const marker of [
    "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
    "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
    "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
    "READY",
    "UNAVAILABLE",
    "Tổ chức đã được thiết lập",
    "Danh bạ Google Workspace đang được đồng bộ.",
    "Lần đồng bộ danh bạ chưa hoàn tất và có thể thử lại an toàn.",
    "Đồng bộ danh bạ đã hết số lần thử an toàn và cần UPTECH kiểm tra.",
    "Danh bạ đã được đồng bộ. Hãy hoàn tất thiết lập để quay lại đăng nhập an toàn.",
    "UPTECH chưa thể xác minh trạng thái thiết lập lúc này. Chưa có quyền truy cập nào được cấp.",
    "Organization setup is complete",
    "Google Workspace Directory is synchronizing.",
    "Directory synchronization did not finish and can be safely retried.",
    "Safe synchronization retries are exhausted and UPTECH needs to inspect the setup.",
    "Directory is synchronized. Finish setup to return to secure sign-in.",
    "UPTECH cannot verify setup status right now. No access has been granted.",
  ]) {
    assert.equal(source.includes(marker), true, `missing provisioning copy: ${marker}`);
  }

  assert.match(source, /<main\b/);
  assert.match(source, /<section\b[^>]*aria-labelledby="provisioning-title"/);
  assert.match(source, /id="provisioning-title"/);
  assert.match(source, /role=\{isProblem \? "alert" : "status"\}/);
  assert.match(source, /aria-live=\{isProblem \? "assertive" : "polite"\}/);
  assert.match(source, /data-testid="provisioning-request-id"/);
  assert.match(source, /max-w-(?:lg|xl)/);
});

test("enterprise login help is a fixed bilingual and actionable explanation", () => {
  assert.equal(existsSync(enterpriseHelpPagePath), true, "enterprise login help must exist");
  if (!existsSync(enterpriseHelpPagePath)) return;

  const source = readFileSync(enterpriseHelpPagePath, "utf8");
  for (const marker of [
    "Đăng nhập doanh nghiệp bằng Google Workspace",
    "UPTECH chặn tài khoản Gmail cá nhân vì quyền truy cập doanh nghiệp yêu cầu tài khoản Google Workspace do công ty quản lý.",
    "Chỉ Google Workspace Super Admin của chính công ty đó mới có thể thiết lập tổ chức lần đầu.",
    "Nhân viên hoặc quản trị viên được ủy quyền chưa đủ quyền thiết lập trong phiên bản V1.",
    "nhân viên cần Membership UPTECH đang hoạt động và ánh xạ Group, OU hoặc Department do OWNER/ADMIN của công ty cấp.",
    "không biến người dùng thành quản trị viên nền tảng hoặc hệ thống UPTECH.",
    "Enterprise access with Google Workspace",
    "UPTECH blocks personal Gmail accounts because enterprise access requires a company-managed Google Workspace account.",
    "Only that company's Google Workspace Super Admin can perform first-time organization setup.",
    "An employee or delegated administrator does not have enough privilege for V1 setup.",
    "an employee needs an active UPTECH Membership and a Group, OU, or Department mapping granted by that company's UPTECH OWNER/ADMIN.",
    "does not make the person an UPTECH platform or system administrator.",
  ]) {
    assert.equal(source.includes(marker), true, `missing enterprise help copy: ${marker}`);
  }

  assert.match(source, /export default async function EnterpriseLoginHelpPage\(\)/);
  assert.match(source, /parseLocale\(cookieStore\.get\(LOCALE_COOKIE_NAME\)\?\.value\)/);
  assert.match(source, /<main\b/);
  assert.match(source, /<article\b[^>]*aria-labelledby="enterprise-login-help-title"/);
  assert.match(source, /<h1\b[^>]*id="enterprise-login-help-title"/);
  assert.match(source, /<ol\b/);
  assert.deepEqual(literalHrefs(source), ["/login"]);
});

test("domain verification help pins Google Admin and return actions", () => {
  assert.equal(existsSync(domainHelpPagePath), true, "domain verification help must exist");
  if (!existsSync(domainHelpPagePath)) return;

  const source = readFileSync(domainHelpPagePath, "utf8");
  for (const marker of [
    "Xác minh domain Google Workspace",
    "Google chưa xác nhận domain Google Workspace là đã được xác minh.",
    "UPTECH không tin domain do người dùng nhập và không suy luận quyền sở hữu tổ chức từ địa chỉ email.",
    "Tài khoản → Miền → Quản lý miền",
    "bản ghi DNS TXT",
    "đã xác minh và đang hoạt động",
    "quay lại UPTECH bằng chính tài khoản đó",
    "không có cách bỏ qua bước xác minh.",
    "Verify your Google Workspace domain",
    "Google has not confirmed the Google Workspace domain as verified.",
    "UPTECH never trusts a typed domain or infers organization ownership from an email address.",
    "Account → Domains → Manage domains",
    "DNS TXT record",
    "verified and active",
    "return to UPTECH with the same account",
    "there is no verification bypass.",
  ]) {
    assert.equal(source.includes(marker), true, `missing domain help copy: ${marker}`);
  }

  assert.match(source, /export default async function DomainVerificationHelpPage\(\)/);
  assert.match(source, /parseLocale\(cookieStore\.get\(LOCALE_COOKIE_NAME\)\?\.value\)/);
  assert.match(source, /<main\b/);
  assert.match(source, /<article\b[^>]*aria-labelledby="domain-verification-help-title"/);
  assert.match(source, /<h1\b[^>]*id="domain-verification-help-title"/);
  assert.match(source, /<ol\b/);
  assert.deepEqual(literalHrefs(source), [
    "/login",
    "https://admin.google.com/ac/domains/manage",
  ]);
  assert.match(
    source,
    /href="https:\/\/admin\.google\.com\/ac\/domains\/manage"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"[\s\S]*?referrerPolicy="no-referrer"/,
  );
});

test("help pages localize only from the locale cookie and ignore hostile queries", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const cases = [
    {
      path: "/help/enterprise-login",
      vi: "Đăng nhập doanh nghiệp bằng Google Workspace",
      en: "Enterprise access with Google Workspace",
      hrefs: ["/login"],
    },
    {
      path: "/help/google-workspace/domain-verification",
      vi: "Xác minh domain Google Workspace",
      en: "Verify your Google Workspace domain",
      hrefs: ["/login", "https://admin.google.com/ac/domains/manage"],
    },
  ];

  for (const entry of cases) {
    for (const [cookie, expected, rejected] of [
      ["uptech-locale=vi", entry.vi, entry.en],
      ["uptech-locale=en", entry.en, entry.vi],
      ["uptech-locale=unsafe", entry.vi, entry.en],
    ]) {
      const response = await fetch(new URL(`${entry.path}?domain=evil.example&returnUrl=https%3A%2F%2Fevil.example%2Ftakeover`, baseUrl), {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const main = mainMarkup(await response.text());
      assert.match(main, new RegExp(expected));
      assert.doesNotMatch(main, new RegExp(rejected));
      assert.doesNotMatch(main, /evil\.example|takeover/);
      assert.deepEqual(
        [...main.matchAll(/<a\b[^>]*href="([^"]+)"/gu)].map((match) => match[1]).sort(),
        [...entry.hrefs].sort(),
      );
      assert.doesNotMatch(main, /<form\b|<input\b|href="\/(?:admin|home|san-pham|nguyen-tac|nang-luc|quy-trinh)\b/);
    }
  }
});

test("login page renders the approved Uptech branding and readable Google action", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/login", baseUrl), {
    headers: { cookie: "uptech-theme=light" },
  });
  assert.equal(response.status, 200);

  const html = await response.text();

  assert.match(
    html,
    /Sử dụng tài khoản Google Workspace do tổ chức của bạn cấp\./,
  );
  assert.match(html, /data-testid="login-uptech-logo"/);
  assert.match(html, /alt="Uptech"[^>]+src="\/logo\.png"/);
  assert.match(
    html,
    /data-testid="google-login-submit"[^>]+class="[^"]*text-\[#0f172a\][^"]*disabled:bg-\[#0f172a\][^"]*disabled:text-white/,
  );
  assert.doesNotMatch(
    html,
    /data-testid="google-login-submit"[^>]+style="color:#0f172a"/,
  );
  assert.match(html, />Tiếp tục với Google Workspace</);
  assert.match(
    html,
    /<form(?=[^>]*action="\/api\/v1\/auth\/google\/transactions")(?=[^>]*method="post")[^>]*>\s*<input(?=[^>]*type="hidden")(?=[^>]*name="intent")(?=[^>]*value="LOGIN")[^>]*\/>/,
  );

  const logoResponse = await fetch(new URL("/logo.png", baseUrl));
  assert.equal(logoResponse.status, 200);
  assert.match(logoResponse.headers.get("content-type") ?? "", /image\/png/);
});

test("personal Google accounts receive Workspace guidance with Uptech branding", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(
    new URL("/login?error=personal_account", baseUrl),
  );
  assert.equal(response.status, 200);

  const html = await response.text();

  assert.match(html, />Cần tài khoản công ty</);
  assert.match(
    html,
    /UPTECH chỉ hỗ trợ tài khoản Google Workspace của doanh nghiệp\./,
  );
  assert.match(html, /data-testid="login-uptech-logo"/);
  assert.match(html, />Đổi tài khoản Google</);
  assert.match(html, /href="\/help\/enterprise-login"[^>]*>Xem trợ giúp đăng nhập<\/a>/);
});

test("login header navigation keeps strong contrast over the video", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/login", baseUrl));
  assert.equal(response.status, 200);

  const html = await response.text();

  assert.match(
    html,
    /<html[^>]+translate="no"/,
  );
  assert.match(html, /<header[^>]+data-media-surface="dark"/);
  const brandStart = html.indexOf('data-testid="login-header-brand"');
  const brandMarkup = html.slice(brandStart, html.indexOf("</a>", brandStart));
  assert.notEqual(brandStart, -1);
  assert.match(brandMarkup, /translate="no"/);
  assert.match(brandMarkup, /text-white/);
  assert.doesNotMatch(brandMarkup, /bg-slate|border-white|shadow-|backdrop-blur/);
  assert.match(
    html,
    /data-testid="login-header-home"[^>]+class="[^"]*bg-slate-950\/65[^"]*text-white/,
  );
  const homeStart = html.indexOf('data-testid="login-header-home"');
  const homeMarkup = html.slice(homeStart, html.indexOf("</a>", homeStart));
  assert.notEqual(homeStart, -1);
  assert.doesNotMatch(homeMarkup, /<svg/);
  assert.doesNotMatch(html, /data-testid="login-header-shell"/);
  assert.match(html, /translate="no"[^>]*>\s*UPTECH KNOWLEDGE\s*</);
});

test("login page omits the redundant Google password notice", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/login", baseUrl), {
    headers: { cookie: "uptech-locale=en" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.doesNotMatch(
    html,
    /UPTECH never receives or stores your Google password\./,
  );
  assert.doesNotMatch(html, /aria-describedby="login-description"/);
});

test("login card links directly to terms and privacy in new tabs", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/login", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();

  for (const { href, label } of [
    { href: "/dieu-khoan-su-dung", label: "Điều khoản sử dụng" },
    { href: "/chinh-sach-bao-mat", label: "Chính sách bảo mật" },
  ]) {
    assert.match(
      html,
      new RegExp(
        `<a(?=[^>]*href="${href}")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>${label}<\\/a>`,
      ),
    );
  }
  assert.doesNotMatch(html, /aria-haspopup="dialog"[^>]*>[^<]*Bảo mật &amp; quyền riêng tư/);
});

test("login page follows the English preference in normal and error states", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const headers = { cookie: "uptech-locale=en" };
  const normalResponse = await fetch(new URL("/login", baseUrl), { headers });
  assert.equal(normalResponse.status, 200);
  const normalHtml = await normalResponse.text();

  assert.match(normalHtml, />Sign in to your workspace</);
  assert.match(normalHtml, /Use your Workspace account\./);
  assert.match(normalHtml, />Continue with Google Workspace</);
  assert.match(normalHtml, />Home</);
  assert.match(normalHtml, /Terms of Use/);
  assert.match(normalHtml, /Privacy Policy/);
  assert.doesNotMatch(normalHtml, /Đăng nhập vào workspace/);

  const errorResponse = await fetch(
    new URL("/login?error=personal_account", baseUrl),
    { headers },
  );
  assert.equal(errorResponse.status, 200);
  const errorHtml = await errorResponse.text();

  assert.match(errorHtml, />A business account is required</);
  assert.match(
    errorHtml,
    /UPTECH supports only business Google Workspace accounts\./,
  );
  assert.match(errorHtml, />Switch Google account</);
  assert.match(errorHtml, /href="\/help\/enterprise-login"[^>]*>Open enterprise login help<\/a>/);
});

test("login states keep an opaque card above the bright looping video background", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(
    new URL("/login?error=personal_account", baseUrl),
  );
  assert.equal(response.status, 200);

  const html = await response.text();

  assert.match(
    html,
    /<video[^>]+data-testid="login-background-video"[^>]+autoPlay=""[^>]+loop=""[^>]+muted=""[^>]+playsInline=""/,
  );
  assert.match(html, /poster="\/media\/login-background-poster\.jpg"/);
  assert.match(html, /<source src="\/media\/login-background\.mp4" type="video\/mp4"/);
  assert.match(html, /data-testid="login-background-poster"/);
  assert.match(
    html,
    /data-testid="login-video-brightness"[^>]+bg-white\/25/,
  );
  assert.match(
    html,
    /data-testid="login-card"[^>]+bg-\[var\(--bg-surface\)\]/,
  );

  const videoResponse = await fetch(
    new URL("/media/login-background.mp4", baseUrl),
  );
  assert.equal(videoResponse.status, 200);
  assert.match(videoResponse.headers.get("content-type") ?? "", /video\/mp4/);
});
