import { timingSafeEqual } from "node:crypto";

import { requestIdFromHeaders } from "@/server/http/problem";
import { createConfiguredGoogleDirectoryProductionWorker } from "@/worker/google-directory-production";

type Environment = Readonly<Record<string, string | undefined>>;
type CronOutcome = "DENIED" | "FAILED" | "IDLE" | "PROCESSED";

interface GoogleDirectoryCronWorker {
  runNext(): Promise<{ readonly kind: "idle" | "processed" }>;
  close(): Promise<void>;
}

interface GoogleDirectoryCronEvent {
  readonly event: "UPTECH_DIRECTORY_CRON_V1";
  readonly request_id: string;
  readonly outcome: CronOutcome;
}

export interface GoogleDirectoryCronDependencies {
  readonly environment: Environment;
  readonly createWorker: (environment: Environment) => GoogleDirectoryCronWorker;
  readonly log: (event: GoogleDirectoryCronEvent) => void;
  readonly now: () => number;
}

const productionDependencies: GoogleDirectoryCronDependencies = Object.freeze({
  environment: process.env,
  createWorker: createConfiguredGoogleDirectoryProductionWorker,
  log(event: GoogleDirectoryCronEvent) {
    console.info(JSON.stringify(event));
  },
  now: Date.now,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const MAX_JOBS_PER_INVOCATION = 10;
const EXECUTION_BUDGET_MS = 210_000;

function isStrongCronSecret(value: string | undefined): value is string {
  return value !== undefined && /^[\x21-\x7e]{32,256}$/u.test(value);
}

function hasExactBearerCredential(headers: Headers, secret: string): boolean {
  const actual = headers.get("authorization");
  if (actual === null) return false;

  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(`Bearer ${secret}`, "utf8");
  return actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes);
}

function logOutcome(
  dependencies: GoogleDirectoryCronDependencies,
  requestId: string,
  outcome: CronOutcome,
): void {
  dependencies.log({
    event: "UPTECH_DIRECTORY_CRON_V1",
    request_id: requestId,
    outcome,
  });
}

function emptyNoStoreResponse(status: 204 | 401 | 503): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createGoogleDirectoryCronGet(
  dependencies: GoogleDirectoryCronDependencies = productionDependencies,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFromHeaders(request.headers);
    const secret = dependencies.environment.CRON_SECRET;
    if (
      dependencies.environment.VERCEL_ENV !== "production" ||
      !isStrongCronSecret(secret) ||
      !hasExactBearerCredential(request.headers, secret)
    ) {
      logOutcome(dependencies, requestId, "DENIED");
      return emptyNoStoreResponse(401);
    }

    let outcome: "idle" | "processed" | undefined;
    let worker: GoogleDirectoryCronWorker | undefined;
    let failed = false;
    try {
      const startedAt = dependencies.now();
      worker = dependencies.createWorker(dependencies.environment);
      for (let index = 0; index < MAX_JOBS_PER_INVOCATION; index += 1) {
        if (
          index > 0 &&
          dependencies.now() - startedAt >= EXECUTION_BUDGET_MS
        ) {
          break;
        }

        const result = await worker.runNext();
        if (result.kind !== "idle" && result.kind !== "processed") {
          failed = true;
          break;
        }
        if (result.kind === "idle") {
          outcome ??= "idle";
          break;
        }
        outcome = "processed";
      }
    } catch {
      failed = true;
    } finally {
      if (worker !== undefined) {
        try {
          await worker.close();
        } catch {
          failed = true;
        }
      }
    }

    if (failed || outcome === undefined) {
      logOutcome(dependencies, requestId, "FAILED");
      return emptyNoStoreResponse(503);
    }

    logOutcome(dependencies, requestId, outcome === "idle" ? "IDLE" : "PROCESSED");
    return emptyNoStoreResponse(204);
  };
}

export const GET = createGoogleDirectoryCronGet();
