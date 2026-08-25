import "server-only";

import { resolveMx } from "node:dns/promises";
import { domainToASCII } from "node:url";

const DNS_TIMEOUT_MS = 5_000;
const PERSONAL_GOOGLE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class WorkEmailVerificationError extends Error {
  constructor(readonly kind: "invalid" | "not_google_workspace" | "unavailable") {
    super("Work email verification failed");
    this.name = "WorkEmailVerificationError";
  }
}

function normalizeDomain(email: string) {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) {
    throw new WorkEmailVerificationError("invalid");
  }

  const asciiDomain = domainToASCII(email.slice(separator + 1).toLowerCase());
  if (!asciiDomain || !DOMAIN_PATTERN.test(asciiDomain)) {
    throw new WorkEmailVerificationError("invalid");
  }

  return asciiDomain;
}

function isGoogleWorkspaceMx(exchange: string) {
  const hostname = exchange.toLowerCase().replace(/\.$/u, "");

  return (
    hostname === "smtp.google.com" ||
    hostname === "aspmx.l.google.com" ||
    /^alt[1-4]\.aspmx\.l\.google\.com$/u.test(hostname) ||
    /^aspmx[2-5]\.googlemail\.com$/u.test(hostname)
  );
}

function isNoMailDomainError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["ENODATA", "ENOTFOUND", "ENONAME"].includes(String(error.code));
}

export async function verifyGoogleWorkspaceEmail(email: string) {
  const domain = normalizeDomain(email);

  if (PERSONAL_GOOGLE_DOMAINS.has(domain)) {
    throw new WorkEmailVerificationError("not_google_workspace");
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const mxRecords = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new WorkEmailVerificationError("unavailable")),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);

    if (!mxRecords.some((record) => isGoogleWorkspaceMx(record.exchange))) {
      throw new WorkEmailVerificationError("not_google_workspace");
    }

    return { domain };
  } catch (error) {
    if (error instanceof WorkEmailVerificationError) throw error;
    if (isNoMailDomainError(error)) {
      throw new WorkEmailVerificationError("not_google_workspace");
    }
    throw new WorkEmailVerificationError("unavailable");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
