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

const [publicNav, homePage, loginPage] = await Promise.all([
  readSource("src/components/landing/PublicNav.tsx"),
  readSource("src/app/page.tsx"),
  readSource("src/components/auth/GoogleWorkspaceLogin.tsx"),
]);

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

if (errors.length > 0) {
  console.error("Production deploy contract failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Production deploy contract passed for github/uptech-knowledge@main.");
