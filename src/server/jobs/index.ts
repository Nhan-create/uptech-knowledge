import "server-only";

import { getDatabasePool } from "../db/core";
import { leaseNextJobFromPool } from "./core";

export * from "./core";

export function leaseNextJob() {
  return leaseNextJobFromPool(getDatabasePool());
}
