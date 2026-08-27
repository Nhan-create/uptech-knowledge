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

test("home footer opens the complete terms of use in a new tab", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const homeResponse = await fetch(new URL("/", baseUrl));
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(
    homeHtml,
    /<a(?=[^>]*href="\/dieu-khoan-su-dung")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>Điều khoản sử dụng<\/a>/,
  );

  const termsResponse = await fetch(
    new URL("/dieu-khoan-su-dung", baseUrl),
  );
  assert.equal(termsResponse.status, 200);
  const termsHtml = await termsResponse.text();

  for (const marker of [
    "Điều khoản sử dụng",
    "Cập nhật:",
    "23/06/2026",
    "Giới thiệu và chấp nhận điều khoản",
    "Bản quyền, thương hiệu và sở hữu trí tuệ",
    "Quyền và trách nhiệm của Uptech",
    "Thông tin người dùng gửi cho Uptech",
    "Quyền và trách nhiệm của người sử dụng",
    "Hạn chế sử dụng",
    "Biểu mẫu, yêu cầu tư vấn và báo giá",
    "Loại trừ trách nhiệm",
    "Cập nhật điều khoản",
    "Liên hệ",
  ]) {
    assert.match(termsHtml, new RegExp(marker));
  }
});

test("home footer opens the complete privacy policy in a new tab", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const homeResponse = await fetch(new URL("/", baseUrl));
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(
    homeHtml,
    /<a(?=[^>]*href="\/chinh-sach-bao-mat")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>Chính sách bảo mật<\/a>/,
  );

  const privacyResponse = await fetch(
    new URL("/chinh-sach-bao-mat", baseUrl),
  );
  assert.equal(privacyResponse.status, 200);
  const privacyHtml = await privacyResponse.text();

  for (const marker of [
    "Chính sách bảo mật",
    "02/06/2026",
    "Đơn vị quản lý dữ liệu",
    "Mục đích và phạm vi áp dụng",
    "Thông tin Uptech thu thập",
    "Cách thông tin được thu thập",
    "Mục đích sử dụng thông tin",
    "Chia sẻ và bên xử lý dữ liệu",
    "Cách Uptech bảo vệ dữ liệu",
    "Thời gian lưu trữ",
    "Quyền của bạn đối với dữ liệu cá nhân",
    "Cookie và công nghệ đo lường",
    "Cập nhật chính sách",
    "Liên hệ về dữ liệu cá nhân",
  ]) {
    assert.match(privacyHtml, new RegExp(marker));
  }
});

test("legal pages render natural unnumbered lists without boxed items", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  for (const path of ["/dieu-khoan-su-dung", "/chinh-sach-bao-mat"]) {
    const response = await fetch(new URL(path, baseUrl));
    assert.equal(response.status, 200, path);
    const html = await response.text();

    assert.match(html, /data-legal-list="natural"/, path);
    assert.doesNotMatch(html, /<ol/, path);
    assert.doesNotMatch(html, /data-legal-item-number/, path);
    assert.doesNotMatch(html, /data-legal-item-card/, path);
  }
});

test("home footer links to the official Facebook and LinkedIn profiles", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Kết nối với chúng tôi/);
  for (const { brand, href, label } of [
    {
      brand: "facebook",
      href: "https://www.facebook.com/uptech.vn/",
      label: "Facebook của Uptech",
    },
    {
      brand: "linkedin",
      href: "https://www.linkedin.com/company/uptechvn/",
      label: "LinkedIn của Uptech",
    },
  ]) {
    assert.match(
      html,
      new RegExp(
        `<a(?=[^>]*href="${href.replaceAll("/", "\\/")}")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")(?=[^>]*aria-label="${label}")[^>]*>[\\s\\S]*?data-brand="${brand}"`,
      ),
    );
  }
});

test("home footer presents complete company contacts, partners, and newsletter signup", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<a(?=[^>]*href="tel:\+84968726135")[^>]*>[\s\S]*?\+84 968 726 135<\/a>/);
  assert.match(html, /<a(?=[^>]*href="mailto:contact@uptech\.vn")[^>]*>[\s\S]*?contact@uptech\.vn<\/a>/);
  assert.match(html, /Uptech cung cấp giải pháp công nghệ, phát triển phần mềm/);
  for (const partner of ["aws", "google-cloud", "microsoft", "salesforce"]) {
    assert.match(html, new RegExp(`data-partner="${partner}"`));
  }
  assert.match(html, /Đăng ký nhận thông tin từ Uptech/);
  assert.match(html, /<input(?=[^>]*type="email")(?=[^>]*name="email")(?=[^>]*required)/);
  assert.match(html, /Cập nhật xu hướng công nghệ mới nhất từ Uptech/);
});

test("home navigation places trial before sign in without arrows and removes hero product actions", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();

  const trialStart = html.indexOf('data-testid="public-nav-trial"');
  const signInStart = html.indexOf('data-testid="public-nav-sign-in"');
  assert.notEqual(trialStart, -1, "trial action is rendered in the public navigation");
  assert.notEqual(signInStart, -1, "sign-in action is rendered in the public navigation");
  assert.ok(trialStart < signInStart, "trial action appears before sign in");

  const trialMarkup = html.slice(trialStart, html.indexOf("</button>", trialStart));
  const signInMarkup = html.slice(signInStart, html.indexOf("</a>", signInStart));
  assert.doesNotMatch(trialMarkup, /<svg/);
  assert.doesNotMatch(signInMarkup, /<svg/);

  const heroMarkup = html.slice(html.indexOf("<main"), html.indexOf('id="product"'));
  assert.doesNotMatch(heroMarkup, /landing-hero-actions/);
  assert.doesNotMatch(heroMarkup, /data-testid="public-nav-trial"/);
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

test("public information pages do not render trial or back-to-home CTA buttons", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  for (const { path } of pages) {
    const response = await fetch(new URL(path, baseUrl));
    assert.equal(response.status, 200, path);
    const html = await response.text();

    assert.doesNotMatch(
      html,
      /Dùng thử (?:sản phẩm|năng lực AI|quy trình)|Về trang Home/,
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

test("demo request dialog isolates its colors from the dark navigation surface", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl), {
    headers: { cookie: "uptech-theme=light" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<dialog[^>]+data-color-scheme="light"/);
});

test("demo request submit action has no arrow icon", async (context) => {
  if (baseUrl === undefined) {
    context.skip("Set PUBLIC_INFO_TEST_BASE_URL to a running web app URL.");
    return;
  }

  const response = await fetch(new URL("/", baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();
  const submitStart = html.indexOf('type="submit"');
  const submitMarkup = html.slice(submitStart, html.indexOf("</button>", submitStart));

  assert.notEqual(submitStart, -1);
  assert.doesNotMatch(submitMarkup, /<svg/);
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
  const triggerStart = html.indexOf('data-testid="settings-menu-trigger"');
  const triggerMarkup = html.slice(triggerStart, html.indexOf("</button>", triggerStart));
  assert.match(
    triggerMarkup,
    /<img(?=[^>]+src="\/media\/settings-gear\.jpg")(?=[^>]+alt="")[^>]*>/,
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
