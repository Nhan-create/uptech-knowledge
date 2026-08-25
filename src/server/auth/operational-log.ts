export type AuthOperation =
  | "GOOGLE_LOGIN_TRANSACTION"
  | "GOOGLE_LOGIN_CALLBACK"
  | "WEB_SESSION_BOOTSTRAP"
  | "HOME_AUTHORIZATION"
  | "WEB_LOGOUT";

export type AuthOperationOutcome =
  | "REDIRECT"
  | "NORMAL"
  | "ONBOARDING"
  | "DENIED"
  | "RATE_LIMITED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "REVOKED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "AUTHORIZED";

export function authOperationalEvent(input: {
  readonly requestId: string;
  readonly operation: AuthOperation;
  readonly outcome: AuthOperationOutcome;
}): Readonly<Record<string, string>> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.requestId,
    )
  ) {
    throw new TypeError("Request identifier is invalid");
  }
  return Object.freeze({
    event: "UPTECH_AUTH_OPERATION_V1",
    request_id: input.requestId,
    operation: input.operation,
    outcome: input.outcome,
  });
}

export function logAuthOperation(input: {
  readonly requestId: string;
  readonly operation: AuthOperation;
  readonly outcome: AuthOperationOutcome;
}): void {
  console.info(JSON.stringify(authOperationalEvent(input)));
}
