import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const androidFingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const iosTeamIdPattern = /^[A-Z0-9]{10}$/;
const outputRoot = resolve(process.env.UPTECH_ASSOCIATION_OUTPUT_ROOT ?? process.cwd());

function requiredAndroidFingerprint() {
  const fingerprint = process.env.UPTECH_ANDROID_APP_LINKS_SHA256?.trim() ?? "";
  if (!androidFingerprintPattern.test(fingerprint)) {
    throw new Error("UPTECH_ANDROID_APP_LINKS_SHA256 must be an uppercase SHA-256 fingerprint");
  }
  return fingerprint;
}

function iosUniversalLinksEnabled() {
  const value = process.env.UPTECH_IOS_UNIVERSAL_LINKS_ENABLED?.trim();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new Error("UPTECH_IOS_UNIVERSAL_LINKS_ENABLED must be true or false");
}

async function writeJson(relativePath, value) {
  const path = resolve(outputRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.env.VERCEL_ENV !== "production") {
  console.log("Mobile association generation skipped outside Vercel production.");
  process.exit(0);
}

const fingerprint = requiredAndroidFingerprint();
await writeJson("public/.well-known/assetlinks.json", [{
  relation: ["delegate_permission/common.handle_all_urls"],
  target: {
    namespace: "android_app",
    package_name: "vn.uptech.uptech_knowledge_mobile",
    sha256_cert_fingerprints: [fingerprint],
  },
}]);

if (iosUniversalLinksEnabled()) {
  const teamId = process.env.UPTECH_IOS_TEAM_ID?.trim() ?? "";
  if (!iosTeamIdPattern.test(teamId)) {
    throw new Error("UPTECH_IOS_TEAM_ID must be a 10-character uppercase Apple Team ID");
  }
  await writeJson("public/apple-app-site-association", {
    applinks: {
      apps: [],
      details: [{
        appID: `${teamId}.vn.uptech.uptechKnowledgeMobile`,
        paths: ["/auth/mobile/callback"],
      }],
    },
  });
} else {
  await Promise.all([
    "public/.well-known/apple-app-site-association",
    "public/apple-app-site-association",
  ].map((relativePath) => rm(resolve(outputRoot, relativePath), { force: true })));
}

console.log("Generated mobile association artifacts for Vercel production.");
