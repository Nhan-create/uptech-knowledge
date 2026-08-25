import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the literal path so the containment proxy can deny trailing-slash
  // variants instead of Next.js normalizing them onto an approved auth route.
  skipTrailingSlashRedirect: true,
  // The workspace also has a documentation lockfile one directory above this
  // app. Pinning the Turbopack root prevents Next.js from treating that file as
  // the Web application's package boundary.
  turbopack: {
    root: process.cwd(),
  },
  // Keep the development-only Next.js indicator away from the app's
  // persistent Settings control in the bottom-right corner.
  devIndicators: {
    position: "bottom-left",
  },
};

export default nextConfig;
