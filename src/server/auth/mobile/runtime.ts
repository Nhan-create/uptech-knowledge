import { getRuntimeDatabasePool } from "../../db/runtime-pool.ts";
import { loadMobileAuthConfig } from "./config.ts";
import { createMobileSessionRepository } from "./repository.ts";
import { createMobileSessionService } from "./session-service.ts";
import { createMobileGoogleRepository } from "./google-repository.ts";
import { createMobileGoogleService } from "./google-service.ts";

export function createMobileAuthRuntime() {
  const config = loadMobileAuthConfig();
  const pool = getRuntimeDatabasePool(config.databaseUrl);
  const repository = createMobileSessionRepository(pool);
  const googleRepository = createMobileGoogleRepository(pool);
  return Object.freeze({
    config,
    pool,
    repository,
    googleRepository,
    googleService: createMobileGoogleService({ config, repository: googleRepository }),
    sessionService: createMobileSessionService({
      repository,
      replayKey: config.refreshReplayKey,
      rateHmacKey: config.rateHmacKey,
    }),
  });
}
