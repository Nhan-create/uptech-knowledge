import assert from "node:assert/strict";
import test from "node:test";

import {
  GoogleLoginCryptoError,
  LOGIN_TRANSACTION_COOKIE_NAME,
  canonicalizeClientIp,
  clientNetworkHmac,
  decodeLoginTransactionCookie,
  decryptPkceVerifier,
  deriveCsrfCredential,
  encodeLoginTransactionCookie,
  encryptPkceVerifier,
  hashProof,
  hashTextProof,
  isCanonicalProof,
  issueOpaqueProof,
  pkceAssociatedData,
  proofHashMatches,
  trustedVercelClientIp,
} from "./crypto.ts";

const RATE_KEY = Buffer.alloc(32, 0x41);
const OTHER_RATE_KEY = Buffer.alloc(32, 0x42);
const PKCE_KEY = Buffer.alloc(32, 0x51);
const OTHER_PKCE_KEY = Buffer.alloc(32, 0x52);
const SESSION_PEPPER = Buffer.alloc(32, 0x61);
const LOCATOR_HASH = Buffer.alloc(32, 0x71);
const PKCE_VERIFIER = "v".repeat(64);

function envelopeContext(
  overrides: Partial<{
    environmentId: string;
    locatorHash: Uint8Array;
    keyVersion: string;
    key: Uint8Array;
  }> = {},
) {
  return {
    environmentId: "production_v1",
    locatorHash: LOCATOR_HASH,
    keyVersion: "kms-2026-08",
    key: PKCE_KEY,
    ...overrides,
  };
}

test("issues independent canonical 256-bit opaque proofs", () => {
  const first = issueOpaqueProof();
  const second = issueOpaqueProof();

  assert.equal(isCanonicalProof(first), true);
  assert.equal(Buffer.from(first, "base64url").byteLength, 32);
  assert.equal(first.length, 43);
  assert.notEqual(first, second);
  assert.equal(isCanonicalProof(second), true);
});

test("hashes proofs and matches them without accepting malformed inputs", () => {
  const proof = issueOpaqueProof();
  const other = issueOpaqueProof();
  const digest = hashProof(proof);

  assert.equal(digest.byteLength, 32);
  assert.equal(proofHashMatches(proof, digest), true);
  assert.equal(proofHashMatches(other, digest), false);
  assert.equal(proofHashMatches("not-a-proof", digest), false);
  assert.equal(proofHashMatches(proof, Buffer.alloc(31)), false);
  assert.throws(() => hashProof("not-a-proof"), GoogleLoginCryptoError);

  for (const value of [
    null,
    undefined,
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(43)}=`,
    "!".repeat(43),
  ]) {
    assert.equal(isCanonicalProof(value), false);
  }
});

test("bounds text proofs and rejects embedded NUL bytes", () => {
  assert.equal(hashTextProof("authorization-code").byteLength, 32);
  assert.throws(() => hashTextProof(""), GoogleLoginCryptoError);
  assert.throws(() => hashTextProof("a".repeat(513)), GoogleLoginCryptoError);
  assert.throws(() => hashTextProof("a\0b"), GoogleLoginCryptoError);
});

test("encodes only the exact host-only login transaction cookie payload", () => {
  const browserCredential = issueOpaqueProof();
  const nonce = issueOpaqueProof();
  const encoded = encodeLoginTransactionCookie({ browserCredential, nonce });

  assert.equal(LOGIN_TRANSACTION_COOKIE_NAME, "__Host-uptech_login_tx");
  assert.equal(encoded, `${browserCredential}.${nonce}`);
  assert.deepEqual(decodeLoginTransactionCookie(encoded), {
    browserCredential,
    nonce,
  });

  for (const malformed of [
    null,
    undefined,
    "",
    `${browserCredential}.${nonce}.extra`,
    `${browserCredential}.invalid`,
    `${browserCredential}-${nonce}`,
  ]) {
    assert.equal(decodeLoginTransactionCookie(malformed), null);
  }

  assert.throws(
    () =>
      encodeLoginTransactionCookie({
        browserCredential: "invalid",
        nonce,
      }),
    GoogleLoginCryptoError,
  );
});

test("derives deterministic, pepper-bound CSRF credentials", () => {
  const session = issueOpaqueProof();
  const first = deriveCsrfCredential(session, SESSION_PEPPER);
  const second = deriveCsrfCredential(session, SESSION_PEPPER);

  assert.equal(first, second);
  assert.equal(isCanonicalProof(first), true);
  assert.notEqual(
    first,
    deriveCsrfCredential(session, Buffer.alloc(32, 0x62)),
  );
  assert.notEqual(first, deriveCsrfCredential(issueOpaqueProof(), SESSION_PEPPER));
  assert.throws(
    () => deriveCsrfCredential("invalid", SESSION_PEPPER),
    GoogleLoginCryptoError,
  );
  assert.throws(
    () => deriveCsrfCredential(session, Buffer.alloc(31)),
    GoogleLoginCryptoError,
  );
});

test("canonicalizes trusted IPv4, mapped IPv4, and IPv6 addresses", () => {
  assert.equal(canonicalizeClientIp(" 203.0.113.9 "), "203.0.113.9");
  assert.equal(canonicalizeClientIp("::FFFF:203.0.113.9"), "203.0.113.9");
  assert.equal(canonicalizeClientIp("2001:DB8::1"), "2001:db8::1");

  for (const invalid of [
    "",
    "unknown",
    "203.0.113.9, 10.0.0.1",
    "203.0.113.999",
    "2001:db8::1%eth0",
    "a".repeat(65),
  ]) {
    assert.throws(() => canonicalizeClientIp(invalid), GoogleLoginCryptoError);
  }
});

test("maps equivalent IPv6 spellings to one rate-limit identity", () => {
  const compressed = canonicalizeClientIp("2001:db8::1");
  const expanded = canonicalizeClientIp("2001:0db8:0:0:0:0:0:1");

  assert.equal(expanded, compressed);
  assert.deepEqual(
    clientNetworkHmac(compressed, RATE_KEY),
    clientNetworkHmac(expanded, RATE_KEY),
  );
});

test("derives a fixed-length, environment-keyed network HMAC", () => {
  const first = clientNetworkHmac("203.0.113.9", RATE_KEY);

  assert.equal(first.byteLength, 32);
  assert.deepEqual(first, clientNetworkHmac("203.0.113.9", RATE_KEY));
  assert.notDeepEqual(first, clientNetworkHmac("203.0.113.10", RATE_KEY));
  assert.notDeepEqual(first, clientNetworkHmac("203.0.113.9", OTHER_RATE_KEY));
  assert.throws(
    () => clientNetworkHmac("203.0.113.9", Buffer.alloc(31)),
    GoogleLoginCryptoError,
  );
});

test("accepts client addresses only from the trusted Vercel edge contract", () => {
  const trusted = new Headers({
    "x-vercel-id": "sin1::iad1::request-id",
    "x-vercel-forwarded-for": "203.0.113.9",
  });
  assert.equal(trustedVercelClientIp(trusted, { VERCEL: "1" }), "203.0.113.9");

  assert.throws(
    () => trustedVercelClientIp(trusted, { VERCEL: "0" }),
    GoogleLoginCryptoError,
  );
  assert.throws(
    () =>
      trustedVercelClientIp(
        new Headers({ "x-vercel-forwarded-for": "203.0.113.9" }),
        { VERCEL: "1" },
      ),
    GoogleLoginCryptoError,
  );
  assert.throws(
    () =>
      trustedVercelClientIp(
        new Headers({
          "x-vercel-id": "sin1::request-id",
          "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1",
        }),
        { VERCEL: "1" },
      ),
    GoogleLoginCryptoError,
  );
});

test("round-trips PKCE verifiers through randomized AES-256-GCM envelopes", () => {
  const context = envelopeContext();
  const first = encryptPkceVerifier(PKCE_VERIFIER, context);
  const second = encryptPkceVerifier(PKCE_VERIFIER, context);

  const firstLength =
    first.nonce.byteLength + first.ciphertext.byteLength + first.tag.byteLength;
  const secondLength =
    second.nonce.byteLength +
    second.ciphertext.byteLength +
    second.tag.byteLength;
  assert.ok(firstLength >= 64 && firstLength <= 256);
  assert.ok(secondLength >= 64 && secondLength <= 256);
  assert.equal(first.envelopeVersion, 1);
  assert.equal(first.algorithm, "AES-256-GCM");
  assert.equal(first.nonce.byteLength, 12);
  assert.equal(first.tag.byteLength, 16);
  assert.equal(Object.isFrozen(first), true);
  assert.notDeepEqual(first, second);
  assert.equal(decryptPkceVerifier(first, context), PKCE_VERIFIER);
  assert.equal(decryptPkceVerifier(second, context), PKCE_VERIFIER);
});

test("constructs the exact contract-bound UTF-8 PKCE associated data", () => {
  assert.equal(
    pkceAssociatedData(envelopeContext()).toString("utf8"),
    `production_v1\x1fWEB_LOGIN\x1fGOOGLE_WEB_LOGIN_V1\x1f${LOCATOR_HASH.toString("hex")}`,
  );
});

test("rejects tampered PKCE envelopes and mismatched AEAD associated data", () => {
  const context = envelopeContext();
  const envelope = encryptPkceVerifier(PKCE_VERIFIER, context);

  const tamperedEnvelopes = [
    {
      ...envelope,
      nonce: Uint8Array.from(envelope.nonce),
    },
    {
      ...envelope,
      ciphertext: Uint8Array.from(envelope.ciphertext),
    },
    {
      ...envelope,
      tag: Uint8Array.from(envelope.tag),
    },
  ];
  tamperedEnvelopes[0].nonce[0] ^= 0x01;
  tamperedEnvelopes[1].ciphertext[0] ^= 0x01;
  tamperedEnvelopes[2].tag[0] ^= 0x01;
  for (const tampered of tamperedEnvelopes) {
    assert.throws(
      () => decryptPkceVerifier(tampered, context),
      GoogleLoginCryptoError,
    );
  }

  const mismatchedContexts = [
    envelopeContext({ environmentId: "preview_v1" }),
    envelopeContext({ locatorHash: Buffer.alloc(32, 0x72) }),
    envelopeContext({ key: OTHER_PKCE_KEY }),
  ];
  for (const mismatched of mismatchedContexts) {
    assert.throws(
      () => decryptPkceVerifier(envelope, mismatched),
      GoogleLoginCryptoError,
    );
  }

  const associatedData = pkceAssociatedData(context);
  assert.equal(
    decryptPkceVerifier(envelope, context, associatedData),
    PKCE_VERIFIER,
  );
  const tamperedAssociatedData = Uint8Array.from(associatedData);
  tamperedAssociatedData[0] ^= 0x01;
  assert.throws(
    () => decryptPkceVerifier(envelope, context, tamperedAssociatedData),
    GoogleLoginCryptoError,
  );

  assert.throws(
    () =>
      decryptPkceVerifier(
        { ...envelope, envelopeVersion: 2 } as unknown as typeof envelope,
        context,
      ),
    GoogleLoginCryptoError,
  );
  assert.throws(
    () =>
      decryptPkceVerifier(
        { ...envelope, algorithm: "AES-128-GCM" } as unknown as typeof envelope,
        context,
      ),
    GoogleLoginCryptoError,
  );
});

test("rejects malformed PKCE verifier, key, key version, and locator inputs", () => {
  for (const verifier of [
    "v".repeat(42),
    "v".repeat(129),
    `${"v".repeat(42)}!`,
  ]) {
    assert.throws(
      () => encryptPkceVerifier(verifier, envelopeContext()),
      GoogleLoginCryptoError,
    );
  }

  for (const context of [
    envelopeContext({ key: Buffer.alloc(31) }),
    envelopeContext({ locatorHash: Buffer.alloc(31) }),
    envelopeContext({ environmentId: "bad environment" }),
    envelopeContext({ keyVersion: "" }),
    envelopeContext({ keyVersion: "a".repeat(129) }),
  ]) {
    assert.throws(
      () => encryptPkceVerifier(PKCE_VERIFIER, context),
      GoogleLoginCryptoError,
    );
  }

  assert.throws(
    () =>
      decryptPkceVerifier(
        Buffer.alloc(63) as unknown as ReturnType<typeof encryptPkceVerifier>,
        envelopeContext(),
      ),
    GoogleLoginCryptoError,
  );
  assert.throws(
    () =>
      decryptPkceVerifier(
        Buffer.alloc(257) as unknown as ReturnType<typeof encryptPkceVerifier>,
        envelopeContext(),
      ),
    GoogleLoginCryptoError,
  );
});
