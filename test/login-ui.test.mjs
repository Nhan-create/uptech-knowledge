import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.LOGIN_TEST_BASE_URL;

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

  assert.match(html, /Sử dụng tài khoản Workspace của bạn\./);
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

  assert.match(html, />Tài khoản không hợp lệ</);
  assert.match(
    html,
    /Vui lòng nhập tài khoản Workspace, không phải tài khoản Google\./,
  );
  assert.match(html, /data-testid="login-uptech-logo"/);
  assert.match(html, />Đăng nhập bằng tài khoản khác</);
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
  assert.match(
    html,
    /data-testid="login-header-brand"[^>]+translate="no"[^>]+class="[^"]*notranslate[^"]*bg-slate-950\/65[^"]*text-white/,
  );
  assert.match(
    html,
    /data-testid="login-header-home"[^>]+class="[^"]*bg-slate-950\/65[^"]*text-white/,
  );
  assert.doesNotMatch(html, /data-testid="login-header-shell"/);
  assert.match(html, /translate="no"[^>]*>\s*UPTECH KNOWLEDGE\s*</);
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
  assert.match(normalHtml, /Security &amp; privacy/);
  assert.doesNotMatch(normalHtml, /Đăng nhập vào workspace/);

  const errorResponse = await fetch(
    new URL("/login?error=personal_account", baseUrl),
    { headers },
  );
  assert.equal(errorResponse.status, 200);
  const errorHtml = await errorResponse.text();

  assert.match(errorHtml, />Invalid account</);
  assert.match(errorHtml, /Please use a Workspace account, not a personal Google account\./);
  assert.match(errorHtml, />Sign in with another account</);
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
