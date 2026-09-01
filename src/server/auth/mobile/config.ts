export const MOBILE_GOOGLE_CALLBACK_URI =
  "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback";
export const MOBILE_APP_RETURN_URI =
  "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback";

export class MobileAuthConfigurationError extends Error {
  override readonly name = "MobileAuthConfigurationError";
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new MobileAuthConfigurationError(`Missing ${name}`);
  return value;
}

function oauthCredentials(environment: Environment): Readonly<{
  clientId: string;
  clientSecret: string;
}> {
  const mobileClientId = environment.GOOGLE_MOBILE_CLIENT_ID?.trim();
  const mobileClientSecret = environment.GOOGLE_MOBILE_CLIENT_SECRET?.trim();
  if (Boolean(mobileClientId) !== Boolean(mobileClientSecret)) {
    throw new MobileAuthConfigurationError("Mobile OAuth override is incomplete");
  }
  if (mobileClientId && mobileClientSecret) {
    return { clientId: mobileClientId, clientSecret: mobileClientSecret };
  }
  return {
    clientId: required(environment, "GOOGLE_CLIENT_ID"),
    clientSecret: required(environment, "GOOGLE_CLIENT_SECRET"),
  };
}

function key(environment: Environment, name: string): Uint8Array {
  const encoded = required(environment, name);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) {
    throw new MobileAuthConfigurationError(`Invalid ${name}`);
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded) {
    throw new MobileAuthConfigurationError(`Invalid ${name}`);
  }
  return Uint8Array.from(decoded);
}

export interface MobileAuthConfig {
  readonly callbackUri: typeof MOBILE_GOOGLE_CALLBACK_URI;
  readonly appReturnUri: typeof MOBILE_APP_RETURN_URI;
  readonly databaseUrl: string;
  readonly environmentId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly rateHmacKey: Uint8Array;
  readonly pkceEncryptionKey: Uint8Array;
  readonly pkceKeyVersion: string;
  readonly sessionPepper: Uint8Array;
  readonly refreshReplayKey: Uint8Array;
}

export function loadMobileAuthConfig(
  environment: Environment = process.env,
): MobileAuthConfig {
  const returnOverride = environment.UPTECH_MOBILE_APP_RETURN_URI?.trim();
  const callbackOverride = environment.UPTECH_MOBILE_GOOGLE_CALLBACK_URI?.trim();
  if (
    (returnOverride && returnOverride !== MOBILE_APP_RETURN_URI) ||
    (callbackOverride && callbackOverride !== MOBILE_GOOGLE_CALLBACK_URI)
  ) {
    throw new MobileAuthConfigurationError("Mobile callback URLs are fixed");
  }
  const environmentId = required(environment, "UPTECH_ENVIRONMENT_ID");
  const pkceKeyVersion = required(environment, "UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(environmentId) ||
      !/^[\x21-\x7e]{1,128}$/u.test(pkceKeyVersion)) {
    throw new MobileAuthConfigurationError("Invalid mobile environment configuration");
  }
  const oauth = oauthCredentials(environment);
  return Object.freeze({
    callbackUri: MOBILE_GOOGLE_CALLBACK_URI,
    appReturnUri: MOBILE_APP_RETURN_URI,
    databaseUrl: required(environment, "DATABASE_URL"),
    environmentId,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    rateHmacKey: key(environment, "UPTECH_ENVIRONMENT_RATE_KEY"),
    pkceEncryptionKey: key(environment, "UPTECH_GOOGLE_LOGIN_PKCE_KEY"),
    pkceKeyVersion,
    sessionPepper: key(environment, "UPTECH_SESSION_PEPPER"),
    refreshReplayKey: key(environment, "UPTECH_MOBILE_REFRESH_REPLAY_KEY"),
  });
}
