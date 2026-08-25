import type { DatabaseClient, WorkerTransactionContext } from "../server/db/core";
import type { LeasedJob } from "../server/jobs/core";

export interface WorkerBoundaryDependencies {
  leaseNextJob(): Promise<LeasedJob | null>;
  withWorkerTransaction<T>(
    context: WorkerTransactionContext,
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T>;
}

export interface WorkerJobContext {
  readonly client: DatabaseClient;
  readonly lease: LeasedJob;
}

export type WorkerJobHandler<T> = (
  context: WorkerJobContext,
) => Promise<T>;

export type WorkerRunResult<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "processed"; readonly jobId: string; readonly result: T };

export function createWorkerBoundary(
  dependencies: WorkerBoundaryDependencies,
) {
  return Object.freeze({
    async runNext<T>(handler: WorkerJobHandler<T>): Promise<WorkerRunResult<T>> {
      const lease = await dependencies.leaseNextJob();
      if (lease === null) {
        return { kind: "idle" };
      }

      const context: WorkerTransactionContext = {
        kind: "worker",
        workspaceId: lease.workspaceId,
        jobId: lease.jobId,
        serviceActor: lease.serviceActor,
        connectorId: lease.connectorId,
        sourceId: lease.sourceId,
        leaseFence: lease.leaseFence,
      };

      const result = await dependencies.withWorkerTransaction(
        context,
        async (client) => handler({ client, lease }),
      );

      return { kind: "processed", jobId: lease.jobId, result };
    },
  });
}
