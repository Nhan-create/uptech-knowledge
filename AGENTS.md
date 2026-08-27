<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production deployment safety

- Production source is `main` only. Never run `vercel --prod`, `vercel deploy --prod`, or promote a deployment created from another branch or a dirty worktree.
- Preserve unfinished work in a local-only `archive/*` branch. Do not push archive branches or use them as Vercel deployment sources.
- Before any production release, run `npm run test:deploy-contract`, the relevant test suite, typecheck, and `npm run build`.
- Create a staged Production deployment from a clean, pushed `main` with custom-domain assignment disabled; verify its four public routes and login video, then promote that exact deployment.
- Do not use `--prebuilt` for production unless the CI job separately proves the source ref is `main`; Vercel system Git metadata is unavailable during a prebuilt local build.
