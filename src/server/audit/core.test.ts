import assert from "node:assert/strict";
import test from "node:test";

import { redactAuditMetadata } from "./core.ts";

test("audit metadata is allowlisted and sensitive fields are always redacted", () => {
  const redacted = redactAuditMetadata(
    {
      action: "connector.authorize",
      outcome: "DENY",
      ignored: "must not be logged",
      accessToken: "raw-token",
      leaseFence: "opaque-worker-authority",
      provider_body: { protected: "provider response" },
    },
    ["action", "outcome", "accessToken", "leaseFence"],
  );

  assert.deepEqual(redacted, {
    action: "connector.authorize",
    outcome: "DENY",
    accessToken: "[REDACTED]",
    leaseFence: "[REDACTED]",
    provider_body: "[REDACTED]",
  });
  assert.equal(Object.isFrozen(redacted), true);
});

test("nested prompts, chunks, errors, and byte buffers never survive redaction", () => {
  const redacted = redactAuditMetadata(
    {
      details: {
        sourceId: "source-1",
        prompt: "ignore previous instructions",
        nested: {
          raw_chunk_text: "protected document text",
          providerResponse: "protected provider body",
        },
        failure: new Error("provider included a bearer token"),
        bytes: Uint8Array.from([1, 2, 3]),
      },
    },
    ["details"],
  );

  assert.deepEqual(redacted, {
    details: {
      sourceId: "source-1",
      prompt: "[REDACTED]",
      nested: {
        raw_chunk_text: "[REDACTED]",
        providerResponse: "[REDACTED]",
      },
      failure: "[REDACTED]",
      bytes: "[REDACTED]",
    },
  });
});

test("audit redaction drops unsupported values and bounds strings and arrays", () => {
  const redacted = redactAuditMetadata(
    {
      durationMs: Number.POSITIVE_INFINITY,
      tags: Array.from({ length: 30 }, (_, index) => `tag-${index}`),
      category: `safe\n${"x".repeat(300)}`,
      callback: () => "not serializable",
    },
    ["durationMs", "tags", "category", "callback"],
  );

  assert.equal("durationMs" in redacted, false);
  assert.equal("callback" in redacted, false);
  assert.equal((redacted.tags as readonly unknown[]).length, 20);
  assert.equal((redacted.category as string).includes("\n"), false);
  assert.equal((redacted.category as string).endsWith("…"), true);
});
