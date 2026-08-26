import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.LOGIN_TEST_BASE_URL;

test("login page renders the approved Uptech branding and readable Google action", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set LOGIN_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/login", baseUrl));
  assert.equal(response.status, 200);

  const html = await response.text();

  assert.match(html, /Sử dụng tài khoản Workspace của bạn\./);
  assert.match(html, /data-testid="login-uptech-logo"/);
  assert.match(html, /alt="Uptech"[^>]+src="\/logo\.png"/);
  assert.match(html, /data-testid="google-login-submit"[^>]+style="color:#0f172a"/);
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
