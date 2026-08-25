export const ALLOW = "ALLOW";
export const DENY = "DENY";

export type AuthorizationDecision = typeof ALLOW | typeof DENY;
export interface AuthorizationResult {
  readonly decision: AuthorizationDecision;
  readonly evaluated_version_ids: readonly string[];
}

export type AuthorizationPolicy<SubjectContext, ResourceLocator> = (
  subjectContext: Readonly<SubjectContext>,
  resourceLocator: Readonly<ResourceLocator>,
) => AuthorizationResult;

const NO_POLICIES: ReadonlyMap<
  string,
  AuthorizationPolicy<never, never>
> = new Map();

function deny(): AuthorizationResult {
  return Object.freeze({
    decision: DENY,
    evaluated_version_ids: Object.freeze([]),
  });
}

export function can<SubjectContext, ResourceLocator>(
  subjectContext: Readonly<SubjectContext>,
  action: string,
  resourceLocator: Readonly<ResourceLocator>,
  policies: ReadonlyMap<
    string,
    AuthorizationPolicy<SubjectContext, ResourceLocator>
  > = NO_POLICIES as ReadonlyMap<
    string,
    AuthorizationPolicy<SubjectContext, ResourceLocator>
  >,
): AuthorizationResult {
  try {
    if (typeof action !== "string" || action.length === 0) {
      return deny();
    }

    const policy = policies.get(action);
    if (policy === undefined) {
      return deny();
    }

    const result = policy(subjectContext, resourceLocator);
    if (
      (result.decision !== ALLOW && result.decision !== DENY) ||
      !Array.isArray(result.evaluated_version_ids) ||
      result.evaluated_version_ids.some(
        (versionId) => typeof versionId !== "string" || versionId.length === 0,
      )
    ) {
      return deny();
    }

    return Object.freeze({
      decision: result.decision,
      evaluated_version_ids: Object.freeze([
        ...result.evaluated_version_ids,
      ]),
    });
  } catch {
    return deny();
  }
}
