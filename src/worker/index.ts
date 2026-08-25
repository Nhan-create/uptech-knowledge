import "server-only";

import { getDatabasePool, withWorkerTransaction } from "../server/db/core";
import { leaseNextJobFromPool } from "../server/jobs/core";
import { createWorkerBoundary } from "./core";

export * from "./core";

export function createConfiguredWorkerBoundary() {
  const pool = getDatabasePool();
  return createWorkerBoundary(
    {
      leaseNextJob: () => leaseNextJobFromPool(pool),
      withWorkerTransaction: (context, work) =>
        withWorkerTransaction(context, work, pool),
    },
  );
}
