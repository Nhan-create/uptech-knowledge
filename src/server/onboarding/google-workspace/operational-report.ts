const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type GoogleWorkspaceBootstrapOperationalRecord = Readonly<
  | {
    event: "GOOGLE_WORKSPACE_BOOTSTRAP_RECONCILE";
    request_id: string;
    outcome: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN";
  }
  | {
    event: "GOOGLE_WORKSPACE_BOOTSTRAP_SECRET_ORPHAN";
    request_id: string;
    outcome: "DESTROY_FAILED";
  }
>;

export type GoogleWorkspaceBootstrapOperationalReporter =
  (record: GoogleWorkspaceBootstrapOperationalRecord) => void;

export function googleWorkspaceBootstrapOperationalEvent(
  input: unknown,
): GoogleWorkspaceBootstrapOperationalRecord {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Bootstrap operational record is invalid");
  }
  const candidate = input as {
    readonly event?: unknown;
    readonly request_id?: unknown;
    readonly outcome?: unknown;
  };
  if (typeof candidate.request_id !== "string" || !UUID_V4.test(candidate.request_id)) {
    throw new TypeError("Bootstrap operational record is invalid");
  }
  if (
    candidate.event === "GOOGLE_WORKSPACE_BOOTSTRAP_RECONCILE" &&
    (candidate.outcome === "COMMITTED" ||
      candidate.outcome === "NOT_COMMITTED" ||
      candidate.outcome === "UNKNOWN")
  ) {
    return Object.freeze({
      event: candidate.event,
      request_id: candidate.request_id,
      outcome: candidate.outcome,
    });
  }
  if (
    candidate.event === "GOOGLE_WORKSPACE_BOOTSTRAP_SECRET_ORPHAN" &&
    candidate.outcome === "DESTROY_FAILED"
  ) {
    return Object.freeze({
      event: candidate.event,
      request_id: candidate.request_id,
      outcome: candidate.outcome,
    });
  }
  throw new TypeError("Bootstrap operational record is invalid");
}

export function reportGoogleWorkspaceBootstrapOperationalEvent(
  input: GoogleWorkspaceBootstrapOperationalRecord,
): void {
  console.info(JSON.stringify(googleWorkspaceBootstrapOperationalEvent(input)));
}
