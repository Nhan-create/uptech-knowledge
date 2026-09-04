import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECOVERY_JSON_CHARS,
  buildRecoveryContactHref,
  getLoginRecoveryFeedback,
  parseBoundedRecoveryJson,
  readBoundedRecoveryJson,
  resolveRecoveryClipboardText,
} from "./login-recovery-local.ts";
import { RECOVERY_STATES } from "../../server/auth/recovery-actions.ts";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

test("bounded JSON accepts an exact boundary string and rejects invalid, oversized, and non-string input", () => {
  assert.deepEqual(parseBoundedRecoveryJson('{"state":"READY"}'), { state: "READY" });
  assert.equal(parseBoundedRecoveryJson("{"), null);
  assert.equal(parseBoundedRecoveryJson("x".repeat(MAX_RECOVERY_JSON_CHARS + 1)), null);
  assert.equal(parseBoundedRecoveryJson({ state: "READY" }), null);
  const padding = " ".repeat(MAX_RECOVERY_JSON_CHARS - 3);
  assert.deepEqual(parseBoundedRecoveryJson(`[1]${padding}`), [1]);
});

test("bounded response JSON accepts normal and exact-bound UTF-8 streams", async () => {
  const normal = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"state":'));
      controller.enqueue(new TextEncoder().encode('"READY"}'));
      controller.close();
    },
  }));
  assert.deepEqual(await readBoundedRecoveryJson(normal), { state: "READY" });

  const exactText = `"${"a".repeat(MAX_RECOVERY_JSON_CHARS - 2)}"`;
  assert.equal(new TextEncoder().encode(exactText).byteLength, MAX_RECOVERY_JSON_CHARS);
  assert.equal(await readBoundedRecoveryJson(new Response(exactText)), "a".repeat(MAX_RECOVERY_JSON_CHARS - 2));
});

test("bounded response JSON cancels a multi-chunk stream as soon as it crosses the byte ceiling", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RECOVERY_JSON_CHARS));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  }));

  assert.equal(await readBoundedRecoveryJson(response), null);
  assert.equal(cancelled, true);
});

test("bounded response JSON fails closed for a missing or errored stream", async () => {
  assert.equal(await readBoundedRecoveryJson(new Response(null)), null);
  const errored = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("stream failed"));
    },
  }));
  assert.equal(await readBoundedRecoveryJson(errored), null);
});

test("fixed clipboard templates are localized and include only a canonical request UUID", () => {
  for (const locale of ["vi", "en"] as const) {
    const superAdmin = resolveRecoveryClipboardText({ template: "SUPER_ADMIN_SETUP_V1", locale, requestId: null });
    const workspace = resolveRecoveryClipboardText({ template: "WORKSPACE_ACCESS_V1", locale, requestId: REQUEST_ID });
    const workspaceWithoutId = resolveRecoveryClipboardText({ template: "WORKSPACE_ACCESS_V1", locale, requestId: "bad<script>" });
    assert.ok(superAdmin?.includes("Google Workspace Super Admin"));
    assert.ok(workspace?.includes(REQUEST_ID));
    assert.equal(workspaceWithoutId?.includes("bad<script>"), false);
    assert.ok(workspaceWithoutId);
  }
});

test("request-ID clipboard template fails closed without a canonical UUID", () => {
  assert.equal(resolveRecoveryClipboardText({ template: "REQUEST_ID_V1", locale: "vi", requestId: REQUEST_ID }), REQUEST_ID);
  assert.equal(resolveRecoveryClipboardText({ template: "REQUEST_ID_V1", locale: "en", requestId: null }), null);
  assert.equal(resolveRecoveryClipboardText({ template: "REQUEST_ID_V1", locale: "en", requestId: "123E4567-E89B-42D3-A456-426614174000" }), null);
  assert.equal(resolveRecoveryClipboardText({ template: "EVIL", locale: "vi", requestId: REQUEST_ID }), null);
  assert.equal(resolveRecoveryClipboardText({ template: "REQUEST_ID_V1", locale: "fr", requestId: REQUEST_ID }), null);
});

test("every locale and clipboard template handles present, absent, and malformed UUIDs", () => {
  for (const locale of ["vi", "en"] as const) {
    for (const template of ["SUPER_ADMIN_SETUP_V1", "WORKSPACE_ACCESS_V1", "REQUEST_ID_V1"] as const) {
      for (const requestId of [REQUEST_ID, null, "not-a-uuid<script>"] as const) {
        const output = resolveRecoveryClipboardText({ template, locale, requestId });
        if (template === "REQUEST_ID_V1") {
          assert.equal(output, requestId === REQUEST_ID ? REQUEST_ID : null);
          continue;
        }
        assert.ok(output);
        assert.equal(output.includes("not-a-uuid<script>"), false);
        assert.equal(output.includes(REQUEST_ID), template === "WORKSPACE_ACCESS_V1" && requestId === REQUEST_ID);
      }
    }
  }
});

test("contact href fixes the recipient and admits only closed state and canonical UUID", () => {
  for (const state of RECOVERY_STATES) {
    const href = buildRecoveryContactHref({ locale: "en", state, requestId: REQUEST_ID });
    assert.ok(href.startsWith("mailto:contact@uptech.vn?"), state);
    const decoded = decodeURIComponent(href);
    assert.ok(decoded.includes(state), state);
    assert.ok(decoded.includes(REQUEST_ID), state);
    assert.equal(decoded.includes("evil.example"), false);
  }
  const forged = buildRecoveryContactHref({ locale: "vi", state: "<img src=evil.example>", requestId: "bad-secret" });
  const decoded = decodeURIComponent(forged);
  assert.ok(forged.startsWith("mailto:contact@uptech.vn?"));
  assert.equal(decoded.includes("evil.example"), false);
  assert.equal(decoded.includes("bad-secret"), false);
});

test("localized feedback is fixed, bounded, and truthful about pending access", () => {
  for (const locale of ["vi", "en"] as const) {
    const values = [
      getLoginRecoveryFeedback({ locale, kind: "WORKING" }),
      getLoginRecoveryFeedback({ locale, kind: "ACTION_FAILURE", requestId: REQUEST_ID }),
      getLoginRecoveryFeedback({ locale, kind: "CLIPBOARD_SUCCESS" }),
      getLoginRecoveryFeedback({ locale, kind: "CLIPBOARD_MANUAL" }),
      getLoginRecoveryFeedback({ locale, kind: "ACCESS_REQUEST_RECEIPT", requestId: REQUEST_ID }),
      getLoginRecoveryFeedback({ locale, kind: "COOLDOWN", cooldownSeconds: 30 }),
    ];
    for (const value of values) {
      assert.equal(typeof value, "string");
      assert.ok((value?.length ?? 0) > 0 && (value?.length ?? 0) <= 512);
      JSON.parse(JSON.stringify(value));
    }
    const receipt = values[4]!.toLowerCase();
    assert.match(receipt, locale === "vi" ? /chờ duyệt/iu : /pending/iu);
    assert.doesNotMatch(receipt, locale === "vi" ? /đã cấp quyền/iu : /access (?:was |has been )?granted/iu);
  }
});

test("feedback omits malformed runtime values and rejects unknown selectors", () => {
  const failure = getLoginRecoveryFeedback({ locale: "en", kind: "ACTION_FAILURE", requestId: "<secret>" });
  assert.ok(failure);
  assert.equal(failure.includes("<secret>"), false);
  assert.equal(getLoginRecoveryFeedback({ locale: "en", kind: "COOLDOWN", cooldownSeconds: 0 }), null);
  assert.equal(getLoginRecoveryFeedback({ locale: "en", kind: "COOLDOWN", cooldownSeconds: 300 }), null);
  assert.equal(getLoginRecoveryFeedback({ locale: "xx", kind: "WORKING" }), null);
  assert.equal(getLoginRecoveryFeedback({ locale: "en", kind: "EVIL" }), null);
});

test("all local outputs are small strings with no HTML contract", () => {
  const outputs = [
    resolveRecoveryClipboardText({ template: "SUPER_ADMIN_SETUP_V1", locale: "vi", requestId: REQUEST_ID }),
    resolveRecoveryClipboardText({ template: "WORKSPACE_ACCESS_V1", locale: "en", requestId: REQUEST_ID }),
    buildRecoveryContactHref({ locale: "en", state: "INTERNAL_ERROR", requestId: REQUEST_ID }),
    getLoginRecoveryFeedback({ locale: "vi", kind: "ACCESS_REQUEST_RECEIPT", requestId: REQUEST_ID }),
  ];
  for (const output of outputs) {
    assert.ok(output && output.length <= 1024);
    assert.equal(output.includes("<script"), false);
    assert.equal(output.includes("dangerouslySetInnerHTML"), false);
  }
});
