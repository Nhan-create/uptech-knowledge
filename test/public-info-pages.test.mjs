import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.PUBLIC_INFO_TEST_BASE_URL;

const pages = [
  { path: "/san-pham", label: "Sản phẩm", marker: "Giá trị sản phẩm" },
  { path: "/nguyen-tac", label: "Nguyên tắc", marker: "Niềm tin trong từng câu trả lời" },
  { path: "/nang-luc", label: "Năng lực", marker: "Bộ công cụ tri thức" },
  { path: "/quy-trinh", label: "Quy trình", marker: "Luồng sử dụng" },
];

test("home keeps its existing sections while navigation opens dedicated pages", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Bộ não tri thức dành cho doanh nghiệp/);
  for (const sectionId of ["product", "trust", "capabilities", "workflow"]) {
    assert.match(html, new RegExp(`id="${sectionId}"`));
  }
  for (const { path, label } of pages) {
    assert.match(html, new RegExp(`href="${path}"[^>]*>${label}<`));
  }
});

test("each public information page makes the product value prominent", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  for (const { path, label, marker } of pages) {
    const response = await fetch(new URL(path, baseUrl));
    assert.equal(response.status, 200, path);
    const html = await response.text();

    assert.match(html, /data-testid="public-info-page"/, path);
    assert.match(html, new RegExp(`data-section-label="${label}"`), path);
    assert.match(html, /UPTECH KNOWLEDGE/, path);
    assert.match(html, new RegExp(marker), path);
    assert.match(html, /data-testid="product-value"/, path);
    assert.match(html, /href="\/login"[^>]*>[^<]*(Đăng nhập|Dùng thử)/, path);
    assert.match(
      html,
      new RegExp(
        `<a(?=[^>]*href="${path}")(?=[^>]*aria-current="page")[^>]*>`,
      ),
      path,
    );
  }
});

test("each information page previews the real product interface and explains its use", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const expectedPreviews = [
    {
      path: "/san-pham",
      preview: "dashboard",
      labels: ["Tổng quan workspace", "Trợ lý AI", "Tài liệu"],
    },
    {
      path: "/nguyen-tac",
      preview: "trust",
      labels: ["Phạm vi nguồn", "Nguồn trích dẫn", "Được cấp quyền"],
    },
    {
      path: "/nang-luc",
      preview: "capabilities",
      labels: ["AI Chat", "Tìm kiếm", "So sánh tài liệu"],
    },
    {
      path: "/quy-trinh",
      preview: "workflow",
      labels: ["Tải tài liệu", "Chọn nguồn", "Kiểm tra trích dẫn"],
    },
  ];

  for (const { path, preview, labels } of expectedPreviews) {
    const response = await fetch(new URL(path, baseUrl));
    assert.equal(response.status, 200, path);
    const html = await response.text();

    assert.match(html, new RegExp(`data-product-preview="${preview}"`), path);
    assert.match(html, /data-testid="preview-purpose"/, path);
    assert.match(html, /Dùng để/, path);
    for (const label of labels) {
      assert.match(html, new RegExp(label), `${path}: ${label}`);
    }
  }
});

test("public information pages follow the current English preference", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/nang-luc", baseUrl), {
    headers: { cookie: "uptech-locale=en" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Capabilities/);
  assert.match(html, /Knowledge toolkit/);
  assert.match(html, /Cited AI Chat/);
  assert.match(html, /Document comparison/);
  assert.match(html, /Sign in/);
});

test("home and demo request dialog fully follow the English preference", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl), {
    headers: { cookie: "uptech-locale=en" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /The knowledge brain for your enterprise/);
  assert.match(html, /Search instantly, get grounded answers/);
  assert.match(html, /Trust starts with visible evidence/);
  assert.match(html, /From scattered documents to actionable answers/);
  assert.match(html, /Request a demo/);
  assert.match(html, /Register for a product demo/);
  assert.match(html, /Company Workspace email/);
  assert.match(html, /What would you like to achieve with UPTECH KNOWLEDGE\?/);
  assert.doesNotMatch(html, /Bộ não tri thức dành cho doanh nghiệp/);
});

test("video-backed public pages preserve readable media text in every theme", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  for (const path of ["/", "/san-pham", "/nguyen-tac", "/nang-luc", "/quy-trinh"]) {
    const response = await fetch(new URL(path, baseUrl), {
      headers: { cookie: "uptech-theme=light" },
    });
    assert.equal(response.status, 200, path);
    const html = await response.text();

    assert.match(html, /data-media-surface="dark"/, path);
  }
});

test("information pages explain detailed product use cases", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  for (const { path } of pages) {
    const response = await fetch(new URL(path, baseUrl));
    assert.equal(response.status, 200, path);
    const html = await response.text();

    assert.match(html, /data-testid="product-use-cases"/, path);
    assert.match(html, /Tình huống sử dụng thực tế/, path);
    assert.equal((html.match(/data-use-case=/g) ?? []).length, 3, path);
  }
});

test("settings launcher keeps a balanced safe-area position", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(
    html,
    /data-testid="settings-menu-root"[^>]+class="[^"]*settings-menu-position[^"]*bottom-4[^"]*right-4/,
  );
  assert.match(
    html,
    /data-testid="settings-menu-trigger"[^>]+class="[^"]*size-11[^"]*focus-visible:ring-2/,
  );
});

test("public branding is protected from browser translation and stays readable on the media surface", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl), {
    headers: { cookie: "uptech-theme=light; uptech-locale=en" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<html[^>]+lang="en"[^>]+translate="no"/);
  assert.match(
    html,
    /data-testid="public-brand"[^>]+translate="no"[^>]+class="[^"]*notranslate/,
  );
  assert.match(
    html,
    /data-testid="public-navigation"[^>]+data-media-surface="dark"/,
  );
});
