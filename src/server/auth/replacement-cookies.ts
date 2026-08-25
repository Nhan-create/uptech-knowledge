export function replacementCookieHeaders(
  staleCookieHeaders: readonly string[],
  replacementCookie: string,
): readonly string[] {
  if (replacementCookie.length === 0) {
    throw new TypeError("Replacement cookie is required");
  }
  return Object.freeze([...staleCookieHeaders, replacementCookie]);
}
