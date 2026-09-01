import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const allowedDomains = new Set([
  "tenant-a.example",
  "tenant-b.example",
  "unknown.example",
]);

function trackedAutomatedTests() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "Unable to enumerate tracked test sources");
  return result.stdout.split("\0").filter((path) =>
    /^(?:src\/.*\.test\.(?:ts|mjs)|test\/.*\.(?:ts|mjs)|db\/verify\/.*\.sql)$/u
      .test(path)
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function normalizeHost(value) {
  return value.replaceAll("\\.", ".").replace(/:\d+$/u, "").toLowerCase();
}

function report(violations, path, source, match) {
  violations.push(`${path}:${lineNumber(source, match.index ?? 0)}`);
}

test("tracked automated tests use only the closed example-domain fixture set", async () => {
  const ownPath = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url)).replaceAll("\\", "/");
  const ownRelativePath = ownPath.slice(repositoryRoot.length).replace(/^\//u, "");
  const paths = new Set([...trackedAutomatedTests(), ownRelativePath]);
  const violations = [];

  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");

    for (const match of source.matchAll(/(?:https?|postgres(?:ql)?):\/\/[^\s"'`/${}?#]+/giu)) {
      const candidate = match[0]
        .replace(/^[a-z]+:\/\/(?:[^@/]+@)?/iu, "")
        .split(":", 1)[0];
      if (/example/iu.test(candidate) && !allowedDomains.has(normalizeHost(candidate))) {
        report(violations, path, source, match);
      }
    }

    for (const match of source.matchAll(/@[a-z0-9.-]*example(?:\.[a-z0-9-]+)*/giu)) {
      const candidate = match[0].slice(1);
      if (!allowedDomains.has(normalizeHost(candidate))) {
        report(violations, path, source, match);
      }
    }

    for (const match of source.matchAll(/(?<![a-z0-9.-])([a-z0-9-]+(?:\\)?\.example)(?![a-z0-9.-])/giu)) {
      if (!allowedDomains.has(normalizeHost(match[1]))) {
        report(violations, path, source, match);
      }
    }

    for (const pattern of [
      /\$\{[^}\r\n]+\}(?:\\)?\.example/gu,
      /[+]\s*["'`](?:\\)?\.example/gu,
      /[a-z0-9-]+\.example\.(?:test|com|net|org)\b/giu,
      /(?<![a-z0-9.-])(?:[a-z0-9-]+(?:\\)?\.)+(?:test|invalid)(?=$|[\s"'`/,:;)\]}?#])/giu,
      /(?<![a-z0-9.-])(?:[a-z0-9-]+(?:\\)?\.)*example(?:\\)?\.(?:com|net|org)(?=$|[\s"'`/,:;)\]}?#])/giu,
    ]) {
      for (const match of source.matchAll(pattern)) {
        report(violations, path, source, match);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Disallowed automated-test domain fixture at ${violations.join(", ")}`,
  );
});
