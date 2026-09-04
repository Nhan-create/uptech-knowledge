import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoutes = ["san-pham", "nguyen-tac", "nang-luc", "quy-trinh"];
const root = resolve(process.env.DEPLOY_CONTRACT_ROOT ?? process.cwd());

if (process.env.VERCEL_ENV !== "production") {
  console.log("Production deploy contract skipped outside Vercel production.");
  process.exit(0);
}

const errors = [];

if (process.env.VERCEL_GIT_COMMIT_REF !== "main") {
  errors.push(
    `production source branch must be main (received ${process.env.VERCEL_GIT_COMMIT_REF || "missing"})`,
  );
}

if (
  process.env.VERCEL_GIT_PROVIDER !== "github" ||
  process.env.VERCEL_GIT_REPO_SLUG !== "uptech-knowledge"
) {
  errors.push("production Git provenance must be github/uptech-knowledge");
}

async function readSource(relativePath) {
  try {
    return await readFile(resolve(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

async function hasNonEmptyFile(relativePath) {
  try {
    return (await stat(resolve(root, relativePath))).size > 0;
  } catch {
    return false;
  }
}

async function pathExists(relativePath) {
  try {
    await stat(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  const source = await readSource(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

const androidFingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const iosTeamIdPattern = /^[A-Z0-9]{10}$/;
const cronSecretPattern = /^[\x21-\x7e]{32,256}$/;
const gcpProjectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const workloadIdentityProviderPattern =
  /^https:\/\/iam\.googleapis\.com\/projects\/\d{6,20}\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,63}\/providers\/[a-z0-9-]{4,63}$/;
const serviceAccountEmailPattern =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const directoryCron = Object.freeze({
  path: "/api/internal/cron/google-directory",
  schedule: "* * * * *",
});

function hasExactDirectoryCron(configuration) {
  if (!configuration || !Array.isArray(configuration.crons) || configuration.crons.length !== 1) {
    return false;
  }
  const [cron] = configuration.crons;
  return cron && typeof cron === "object" &&
    Object.keys(cron).length === 2 &&
    cron.path === directoryCron.path &&
    cron.schedule === directoryCron.schedule;
}

function configuredAndroidFingerprint() {
  const fingerprint = process.env.UPTECH_ANDROID_APP_LINKS_SHA256?.trim() ?? "";
  return androidFingerprintPattern.test(fingerprint) ? fingerprint : null;
}

function iosUniversalLinksEnabled() {
  const value = process.env.UPTECH_IOS_UNIVERSAL_LINKS_ENABLED?.trim();
  if (value === "false") return false;
  if (value === "true") return true;
  errors.push("iOS universal links flag must be true or false");
  return false;
}

function validAssetLinks(value, fingerprint) {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const [statement] = value;
  const target = statement && typeof statement === "object" ? statement.target : null;
  return Object.keys(statement ?? {}).sort().join(",") === "relation,target" &&
    Array.isArray(statement.relation) &&
    statement.relation.length === 1 &&
    statement.relation[0] === "delegate_permission/common.handle_all_urls" &&
    target && typeof target === "object" &&
    Object.keys(target).sort().join(",") ===
      "namespace,package_name,sha256_cert_fingerprints" &&
    target.namespace === "android_app" &&
    target.package_name === "vn.uptech.uptech_knowledge_mobile" &&
    Array.isArray(target.sha256_cert_fingerprints) &&
    target.sha256_cert_fingerprints.length === 1 &&
    target.sha256_cert_fingerprints[0] === fingerprint;
}

function validAppleAssociation(value, teamId) {
  const appId = `${teamId}.vn.uptech.uptechKnowledgeMobile`;
  const applinks = value && typeof value === "object" ? value.applinks : null;
  if (!applinks || typeof applinks !== "object") return false;
  if (!Array.isArray(applinks.details) || applinks.details.length !== 1) return false;
  const [detail] = applinks.details;
  return Object.keys(value).join(",") === "applinks" &&
    Object.keys(applinks).sort().join(",") === "apps,details" &&
    Array.isArray(applinks.apps) && applinks.apps.length === 0 &&
    detail && typeof detail === "object" &&
    Object.keys(detail).sort().join(",") === "appID,paths" &&
    detail.appID === appId &&
    Array.isArray(detail.paths) && detail.paths.length === 1 &&
    detail.paths[0] === "/auth/mobile/callback";
}

const [publicNav, homePage, loginPage] = await Promise.all([
  readSource("src/components/landing/PublicNav.tsx"),
  readSource("src/app/page.tsx"),
  readSource("src/components/auth/GoogleWorkspaceLogin.tsx"),
]);

const vercelConfiguration = await readJson("vercel.json");
if (
  !hasExactDirectoryCron(vercelConfiguration) ||
  !(await hasNonEmptyFile("src/app/api/internal/cron/google-directory/route.ts"))
) {
  errors.push("Directory cron deployment contract is incomplete");
}

if (!cronSecretPattern.test(process.env.CRON_SECRET ?? "")) {
  errors.push("Directory cron secret is missing or invalid");
}

if (
  !gcpProjectIdPattern.test(process.env.UPTECH_GCP_SECRET_MANAGER_PROJECT_ID ?? "") ||
  !workloadIdentityProviderPattern.test(process.env.UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER ?? "") ||
  !serviceAccountEmailPattern.test(
    process.env.UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL ?? "",
  )
) {
  errors.push("Google Cloud Directory workload identity metadata is missing or invalid");
}

const hasEveryPublicRoute = publicRoutes.every(
  (route) =>
    publicNav.includes(`href: "/${route}"`) &&
    publicNav.includes(`href={item.href}`),
);
const hasEveryPublicRouteFile = (
  await Promise.all(
    publicRoutes.map((route) =>
      hasNonEmptyFile(`src/app/${route}/page.tsx`),
    ),
  )
).every(Boolean);

if (!hasEveryPublicRoute || !hasEveryPublicRouteFile) {
  errors.push("dedicated public route links are incomplete");
}

const legacyFragmentPattern = /(?:href:\s*|href=)["']#(?:product|trust|capabilities|workflow)["']/;

if (
  legacyFragmentPattern.test(publicNav) ||
  legacyFragmentPattern.test(homePage)
) {
  errors.push("legacy fragment navigation is forbidden");
}

if (!publicNav.includes("border-0 bg-transparent p-0 shadow-none")) {
  errors.push("transparent public logo contract is missing");
}

const hasLoginMarkup =
  loginPage.includes('poster="/media/login-background-poster.jpg"') &&
  loginPage.includes('src="/media/login-background.mp4"') &&
  loginPage.includes('type="video/mp4"');
const hasLoginMedia =
  (await hasNonEmptyFile("public/media/login-background.mp4")) &&
  (await hasNonEmptyFile("public/media/login-background-poster.jpg"));

if (!hasLoginMarkup || !hasLoginMedia) {
  errors.push("login background video contract is incomplete");
}

const androidFingerprint = configuredAndroidFingerprint();
if (!androidFingerprint) {
  errors.push("Android release fingerprint is missing or invalid");
}
const assetLinks = await readJson("public/.well-known/assetlinks.json");
if (androidFingerprint && !validAssetLinks(assetLinks, androidFingerprint)) {
  errors.push("Android assetlinks association is incomplete");
}

if (iosUniversalLinksEnabled()) {
  const teamId = process.env.UPTECH_IOS_TEAM_ID?.trim() ?? "";
  if (!iosTeamIdPattern.test(teamId)) {
    errors.push("iOS Team ID is missing or invalid");
  } else {
    const [rootAssociation, wellKnownAssociation] = await Promise.all([
      readJson("public/apple-app-site-association"),
      readJson("public/.well-known/apple-app-site-association"),
    ]);
    if (
      !validAppleAssociation(rootAssociation, teamId) ||
      !validAppleAssociation(wellKnownAssociation, teamId) ||
      JSON.stringify(rootAssociation) !== JSON.stringify(wellKnownAssociation)
    ) {
      errors.push("iOS universal links association is incomplete");
    }
  }
} else if ((await Promise.all([
  "public/.well-known/apple-app-site-association",
  "public/apple-app-site-association",
].map(pathExists))).some(Boolean)) {
  errors.push("iOS universal links association must be absent when disabled");
}

if (errors.length > 0) {
  console.error("Production deploy contract failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Production deploy contract passed for github/uptech-knowledge@main.");
