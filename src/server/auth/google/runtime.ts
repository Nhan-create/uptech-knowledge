import { getRuntimeDatabasePool } from "../../db/runtime-pool.ts";
import { loadGoogleLoginRuntimeConfig } from "./config.ts";
import { createGoogleLoginRepository } from "./repository.ts";
import { createGoogleLoginService } from "./service.ts";

export function createGoogleLoginRuntime() {
  const config = loadGoogleLoginRuntimeConfig();
  const pool = getRuntimeDatabasePool(config.databaseUrl);
  const repository = createGoogleLoginRepository(pool);
  return Object.freeze({
    config,
    pool,
    repository,
    service: createGoogleLoginService({ config, repository }),
  });
}
