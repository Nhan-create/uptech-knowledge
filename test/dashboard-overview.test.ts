import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FIXTURE_DOCUMENTS,
  FIXTURE_SPACES,
} from "../src/features/knowledge/fixtures/catalog.ts";
import type {
  DocumentSummaryView,
  SpaceSummaryView,
} from "../src/features/knowledge/model.ts";
import {
  buildDashboardChatHref,
  buildDashboardSearchHref,
  DASHBOARD_HERO_PRESETS,
  findHeroMatchingDocuments,
  normalizeFold,
  resolveChatScopeForSpace,
} from "../src/features/dashboard/hero-matching.ts";

function buildTestCatalog(): {
  spaces: SpaceSummaryView[];
  documents: DocumentSummaryView[];
} {
  const spaceMap = new Map(FIXTURE_SPACES.map((space) => [space.id, space]));
  const spaces: SpaceSummaryView[] = FIXTURE_SPACES.map((space) => ({
    ...space,
    documentCount: FIXTURE_DOCUMENTS.filter((doc) => doc.spaceId === space.id).length,
  }));
  const documents: DocumentSummaryView[] = FIXTURE_DOCUMENTS.map((doc) => {
    const space = spaceMap.get(doc.spaceId);
    if (!space) throw new Error(`Missing space ${doc.spaceId}`);
    return {
      id: doc.id,
      name: doc.name,
      fileType: doc.fileType,
      versionLabel: doc.versionLabel,
      detail: doc.detail,
      ownerLabel: doc.ownerLabel,
      updatedLabel: doc.updatedLabel,
      space: { id: space.id, name: space.name },
      processing: doc.processing,
      governance: doc.governance,
    };
  });
  return { spaces, documents };
}

test("findHeroMatchingDocuments strictly enforces Ready-Only on fixture catalog", () => {
  const { documents } = buildTestCatalog();

  // Default VI preset must match Ready policy doc and exclude Đang OCR (doc_e39b80)
  const defaultResult = findHeroMatchingDocuments(
    documents,
    DASHBOARD_HERO_PRESETS[0].vi,
    "all",
  );
  assert.ok(defaultResult.matches.length >= 1);
  assert.equal(defaultResult.matches[0]?.id, "doc_a91f07");
  for (const doc of defaultResult.matches) {
    assert.equal(doc.processing.kind, "ready");
    assert.notEqual(doc.id, "doc_e39b80");
  }

  // Every VI and EN preset resolves exclusively to Ready documents
  const expectedIds = ["doc_a91f07", "doc_b40c22", "doc_19de58"] as const;
  DASHBOARD_HERO_PRESETS.forEach((preset, idx) => {
    const viRes = findHeroMatchingDocuments(documents, preset.vi, "all");
    const enRes = findHeroMatchingDocuments(documents, preset.en, "all");
    assert.equal(viRes.matches[0]?.id, expectedIds[idx]);
    assert.equal(enRes.matches[0]?.id, expectedIds[idx]);
    assert.ok(viRes.matches.every((d) => d.processing.kind === "ready"));
    assert.ok(enRes.matches.every((d) => d.processing.kind === "ready"));
  });
});

test("findHeroMatchingDocuments returns empty matches for OCR-only scope and unmatched queries", () => {
  const { documents } = buildTestCatalog();

  // Vận hành (spc_c14d72) has only doc_e39b80 (OCR) and zero ready docs
  const opsResult = findHeroMatchingDocuments(documents, "cẩm nang vận hành", "spc_c14d72");
  assert.equal(opsResult.matches.length, 0);
  assert.equal(opsResult.readyCountInScope, 0);
  assert.equal(opsResult.processingCountInScope, 1);
  assert.equal(opsResult.nonReadyCountInScope, 1);

  // Unmatched query in all-spaces scope does not fabricate fallback citations
  const unmatched = findHeroMatchingDocuments(
    documents,
    "chinh sach nghi phep 2099 xyz",
    "all",
  );
  assert.equal(unmatched.matches.length, 0);
  assert.equal(unmatched.readyCountInScope, 3);

  // Empty query returns only ready suggestions
  const emptyQuery = findHeroMatchingDocuments(documents, "   ", "all");
  assert.equal(emptyQuery.matches.length, 3);
  assert.ok(emptyQuery.matches.every((d) => d.processing.kind === "ready"));
});

test("normalizeFold folds Vietnamese đ/Đ alongside NFD diacritics", () => {
  assert.equal(
    normalizeFold("Quy định đội nhóm Đầu tuần"),
    "quy dinh doi nhom dau tuan",
  );
});

test("scope mapping and hero URL builders preserve scope on /chat and /search", () => {
  const { spaces } = buildTestCatalog();

  assert.equal(resolveChatScopeForSpace("all", spaces), "all");
  assert.equal(resolveChatScopeForSpace("spc_8f2a01", spaces), "hr");
  assert.equal(resolveChatScopeForSpace("spc_c14d72", spaces), "operations");
  assert.equal(resolveChatScopeForSpace("spc_6be903", spaces), "atlas");

  const hrUrl = buildDashboardChatHref("Làm việc từ xa", "spc_8f2a01", spaces);
  const parsedHr = new URL(hrUrl, "http://localhost:3000");
  assert.equal(parsedHr.pathname, "/chat");
  assert.equal(parsedHr.searchParams.get("prompt"), "Làm việc từ xa");
  assert.equal(parsedHr.searchParams.get("scope"), "hr");

  const emptyPromptAtlas = buildDashboardChatHref("   ", "spc_6be903", spaces);
  assert.equal(emptyPromptAtlas, "/chat?scope=atlas");

  const allSpacesNoPrompt = buildDashboardChatHref("", "all", spaces);
  assert.equal(allSpacesNoPrompt, "/chat");

  const searchUrl = buildDashboardSearchHref("remote work", "spc_8f2a01");
  const parsedSearch = new URL(searchUrl, "http://localhost:3000");
  assert.equal(parsedSearch.pathname, "/search");
  assert.equal(parsedSearch.searchParams.get("q"), "remote work");
  assert.equal(parsedSearch.searchParams.get("space"), "spc_8f2a01");
});

test("AppShell and Dashboard source contracts prevent a11y label mismatch and empty submit silence", () => {
  const appShellSource = readFileSync("src/components/app-shell/AppShell.tsx", "utf8");
  assert.equal(appShellSource.includes("aria-label={copy.quickSearch}"), false);
  assert.equal(appShellSource.includes("An Nguyễn"), false);
  assert.equal(appShellSource.includes(">AN<"), false);
  assert.ok(appShellSource.includes('<span className="sr-only">{copy.profileLabel}</span>'));
  assert.ok(appShellSource.includes("min-[420px]:inline"));
  assert.ok(appShellSource.includes("sr-only sm:not-sr-only"));

  const heroSource = readFileSync("src/features/dashboard/DashboardHeroShowcase.tsx", "utf8");
  assert.ok(heroSource.includes('id="hero-ask-error"'));
  assert.ok(heroSource.includes("findHeroMatchingDocuments"));
  assert.ok(heroSource.includes("buildDashboardChatHref"));

  const drawerSource = readFileSync(
    "src/features/dashboard/DashboardSourceDrawer.tsx",
    "utf8",
  );
  assert.ok(drawerSource.includes('document.processing.kind === "ready"'));
  assert.ok(drawerSource.includes("buildDashboardChatHref"));
});
