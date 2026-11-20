import { createConfiguredGoogleDirectoryProductionWorker } from "../../../worker/google-directory-production.ts";
import { getRuntimeDatabasePool } from "../../db/runtime-pool.ts";
import { loadGoogleLoginRuntimeConfig } from "./config.ts";
import { createGoogleLoginRepository } from "./repository.ts";
import { createGoogleLoginService } from "./service.ts";

const LOGIN_DIRECTORY_REFRESH_MAX_JOBS = 5;
const LOGIN_DIRECTORY_REFRESH_BUDGET_MS = 8_000;

async function refreshDueDirectorySync(): Promise<void> {
  let worker: ReturnType<typeof createConfiguredGoogleDirectoryProductionWorker> | undefined;
  const startedAt = Date.now();
  try {
    worker = createConfiguredGoogleDirectoryProductionWorker();
    for (let i = 0; i < LOGIN_DIRECTORY_REFRESH_MAX_JOBS; i += 1) {
      if (Date.now() - startedAt > LOGIN_DIRECTORY_REFRESH_BUDGET_MS) {
        break;
      }
      const result = await worker.runNext();
      if (result.kind === "idle") {
        break;
      }
    }
  } catch {
    // Fail closed inside complete_web_google_login_directory_v2 if freshness could not be renewed.
  } finally {
    if (worker !== undefined) {
      await worker.close().catch(() => {});
    }
  }
}

export function createGoogleLoginRuntime() {
  const config = loadGoogleLoginRuntimeConfig();
  const pool = getRuntimeDatabasePool(config.databaseUrl);
  const repository = createGoogleLoginRepository(pool);
  return Object.freeze({
    config,
    pool,
    repository,
    service: createGoogleLoginService({ config, repository }),
    refreshDueDirectorySync,
  });
}
