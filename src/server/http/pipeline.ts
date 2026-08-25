import {
  createSafeProblem,
  type ProblemDocument,
  safeProblemFromUnknown,
} from "./problem.ts";
import { TenantRateLimitUnavailableError } from "../rate-limit/core.ts";

export const REQUEST_PIPELINE_ORDER = Object.freeze([
  "enforce_method_content_type_body_size",
  "authenticate",
  "bind_workspace_membership",
  "enforce_web_csrf",
  "enforce_pre_auth_or_subject_rate_limit",
  "validate_structure_and_ids",
  "masked_lookup_and_authorize",
  "validate_semantics_and_business_rules",
  "execute_service_and_data_access",
] as const);

export type RequestPipelineStage = (typeof REQUEST_PIPELINE_ORDER)[number];

export const CONTINUE_PIPELINE = Object.freeze({ outcome: "CONTINUE" } as const);

export type PipelineStageResult =
  | typeof CONTINUE_PIPELINE
  | {
      readonly outcome: "STOP";
      readonly problem: ProblemDocument;
    };

export type PipelineStageHandler<Context> = (
  context: Context,
) => PipelineStageResult | Promise<PipelineStageResult>;

export type RequestPipelineHandlers<Context> = Readonly<
  Record<RequestPipelineStage, PipelineStageHandler<Context>>
>;

export type RequestPipelineResult =
  | { readonly completed: true }
  | {
      readonly completed: false;
      readonly stopped_at: RequestPipelineStage;
      readonly problem: ProblemDocument;
    };

export async function runRequestPipeline<Context>(
  context: Context,
  handlers: RequestPipelineHandlers<Context>,
): Promise<RequestPipelineResult> {
  for (const stage of REQUEST_PIPELINE_ORDER) {
    try {
      const handler = handlers[stage];
      if (typeof handler !== "function") {
        throw new TypeError(`missing request pipeline stage: ${stage}`);
      }

      const result = await handler(context);
      if (result.outcome === "STOP") {
        return {
          completed: false,
          stopped_at: stage,
          problem: result.problem,
        };
      }
      if (result.outcome !== "CONTINUE") {
        throw new TypeError(`invalid request pipeline result: ${stage}`);
      }
    } catch (error) {
      return {
        completed: false,
        stopped_at: stage,
        problem:
          stage === "enforce_pre_auth_or_subject_rate_limit" &&
          error instanceof TenantRateLimitUnavailableError
            ? createSafeProblem("PROVIDER_UNAVAILABLE")
            : safeProblemFromUnknown(error),
      };
    }
  }

  return { completed: true };
}
