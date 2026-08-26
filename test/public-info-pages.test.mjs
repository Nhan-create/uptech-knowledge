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
