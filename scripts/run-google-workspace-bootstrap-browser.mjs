import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const CONTRACT = Object.freeze({
  browser: "chromium-cdp-websocket",
  build: "fresh-next-production-build",
  canonicalOrigin: "https://browser-login.test:<ephemeral>",
  childEnvironment: "explicit-allowlist",
  cleanup: ["browser", "next", "proxies", "runtime-role", "child-database", "profile"],
  credentialPostComparison: "sha256+bounded-shape",
  database: "uptech_phase1_test_browser_[A-Za-z0-9_]+",
  liveTests: [
    "test/login-ui.test.mjs",
    "test/login-auth-safety.test.mjs",
    "test/login-browser-interactions.test.mjs",
  ],
  migrations: ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"],
  provisioning: "hydrated-pending-retry-support-ready-double-submit",
  runtime: "session_user=ephemeral,current_user=uptech_api_runtime,NOBYPASSRLS",
  timeouts: "bounded-cdp-server-cleanup",
});

if (process.argv[2] === "--contract") {
  process.stdout.write(`${JSON.stringify(CONTRACT)}\n`);
  process.exit(0);
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceUrlText = process.env.UPTECH_TEST_DATABASE_URL;
assert.ok(sourceUrlText, "UPTECH_TEST_DATABASE_URL is required");
const sourceUrl = new URL(sourceUrlText);
const sourceDatabase = decodeURIComponent(sourceUrl.pathname.slice(1));
assert.equal(["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname), true, "refusing a non-loopback test database");
assert.match(sourceDatabase, /^uptech_phase1_test[A-Za-z0-9_]*$/u, "refusing a non-test source database");

const suffix = `${process.pid}_${randomBytes(6).toString("hex")}`;
const childDatabase = `uptech_phase1_test_browser_${suffix}`;
const runtimeRole = `uptech_browser_api_${suffix}`;
assert.match(childDatabase, /^uptech_phase1_test_browser_[A-Za-z0-9_]+$/u);
assert.match(runtimeRole, /^uptech_browser_api_[A-Za-z0-9_]+$/u);
const runtimePassword = randomBytes(32).toString("base64url");
const sessionCredential = randomBytes(32).toString("base64url");
const sessionPepper = randomBytes(32);
const csrfCredential = createHmac("sha256", sessionPepper)
  .update("uptech:web-session:csrf:v1\0", "utf8")
  .update(sessionCredential, "utf8")
  .digest("base64url");
const localKey = randomBytes(32);
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const childOwnerUrl = new URL(sourceUrl);
childOwnerUrl.pathname = `/${childDatabase}`;
const runtimeUrl = new URL(childOwnerUrl);
runtimeUrl.username = runtimeRole;
runtimeUrl.password = runtimePassword;
runtimeUrl.searchParams.set("options", "-c role=uptech_api_runtime");
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10_000 });
let childOwner;
let roleCreated = false;
let databaseCreated = false;
let temporaryRoot;
let nextProcess;
let browserProcess;
let httpProxy;
let httpsProxy;
let failurePhase = "bootstrap";

const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP",
  "LOCALAPPDATA", "APPDATA", "USERPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
]);
function childEnvironment(extra = {}) {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}
async function bounded(work, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

function safeFailureCode(error) {
  return typeof error?.code === "string" && /^[A-Za-z0-9_]{1,32}$/u.test(error.code)
    ? error.code
    : "HARNESS_FAILURE";
}

function delay(milliseconds) { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }
async function port() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (platform() === "win32") {
    await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { label: "process-tree cleanup failed" });
  } else child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "exit"), delay(5_000)]);
  }
  assert.notEqual(child.exitCode, null, "child process cleanup failed");
}
async function closeServer(server) {
  if (!server) return;
  await bounded(new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())), 5_000, "server close timeout");
}
async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: repoRoot, stdio: options.stdio ?? "ignore", env: options.env ?? childEnvironment() });
  const [code] = await bounded(once(child, "exit"), options.timeout ?? 120_000, "child command timeout");
  if (code !== 0) throw new Error(options.label ?? "child command failed");
}
function forwardToNext(nextPort, canonicalHost) {
  return (request, response) => {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: nextPort,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: canonicalHost,
        "x-vercel-id": "sin1::iad1::browser-test",
        "x-vercel-forwarded-for": "203.0.113.9",
        "x-forwarded-host": canonicalHost,
        "x-forwarded-port": canonicalHost.split(":").at(-1),
        "x-forwarded-proto": "https",
      },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  };
}
async function browserTarget(portNumber) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(100);
  }
  throw new Error("Chromium CDP endpoint did not become ready");
}

let failure;
try {
  failurePhase = "build";
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
    env: childEnvironment({ NEXT_TELEMETRY_DISABLED: "1", VERCEL_ENV: "preview" }),
    stdio: "inherit", timeout: 180_000, label: "fresh production build failed",
  });
  assert.ok(await readFile(join(repoRoot, ".next", "BUILD_ID"), "utf8"), "run npm run build before browser acceptance");
  failurePhase = "database-bootstrap";
  await admin.connect();
  const absent = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [childDatabase]);
  assert.equal(absent.rowCount, 0, "generated child database already exists");
  await admin.query(`CREATE DATABASE ${childDatabase}`);
  databaseCreated = true;
  childOwner = new pg.Client({ connectionString: childOwnerUrl.toString(), connectionTimeoutMillis: 10_000 });
  await childOwner.connect();
  await childOwner.query("CREATE SCHEMA uptech AUTHORIZATION uptech_migration_owner");
  await childOwner.query("GRANT USAGE ON SCHEMA uptech TO uptech_api_runtime, uptech_worker_runtime");
  for (const [index, name] of [
    "0001_phase1_foundation.sql", "0002_google_auth_a1.sql", "0003_initial_owner_bootstrap_a2.sql",
    "0004_mobile_public_client_auth_a3.sql", "0005_mobile_session_direct_access_boundary_a3.sql",
    "0006_safe_google_access_states_a4.sql", "0007_enterprise_login.sql",
    "0008_google_directory_production.sql", "0009_google_workspace_tenant_bootstrap.sql",
  ].entries()) {
    assert.equal(index + 1, Number(name.slice(0, 4)));
    const sql = (await readFile(join(repoRoot, "db", "migrations", name), "utf8"))
      .replace(/^\\set ON_ERROR_STOP on\r?\n/u, "");
    await childOwner.query(sql);
  }
  await admin.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  roleCreated = true;
  await admin.query(`GRANT uptech_api_runtime TO ${runtimeRole} WITH INHERIT FALSE, SET TRUE`);

  const tlsPort = await port();
  const nextPort = tlsPort;
  const transportPort = await port();
  const cdpPort = await port();
  const canonicalOrigin = `https://browser-login.test:${tlsPort}`;
  const canonicalHost = new URL(canonicalOrigin).host;
  const transportOrigin = `http://127.0.0.1:${transportPort}`;
  const clientId = "browser-test-client.apps.googleusercontent.com";
  const ids = Array.from({ length: 10 }, () => randomUUID());
  const onboardingCredential = randomBytes(32).toString("base64url");
  const sourceCredential = randomBytes(32).toString("base64url");
  await childOwner.query("BEGIN");
  await childOwner.query("SET LOCAL ROLE uptech_migration_owner");
  await childOwner.query(`INSERT INTO uptech.google_auth_environment_registry(environment_name,rate_limit_audit_hmac_key,is_active) VALUES ('browser-test',$1,true)`, [localKey]);
  await childOwner.query(`INSERT INTO uptech.google_auth_configuration_registry(configuration_key,environment_name,purpose,google_client_id,google_audience,audience_configuration_key,callback_uri,scopes,allowed_azp_configuration_keys,web_pkce_kms_key_version,is_enabled) VALUES ('GOOGLE_WEB_LOGIN_V1','browser-test','WEB_LOGIN',$1,$1,'GOOGLE_WEB_LOGIN_V1',$2,ARRAY['openid','email','profile']::text[],ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],'local-browser-test-v1',true)`, [clientId, `${canonicalOrigin}/api/v1/auth/google/callback`]);
  await childOwner.query("INSERT INTO uptech.users(id,status) VALUES($1,'ACTIVE')", [ids[0]]);
  await childOwner.query("INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,email_claim,email_verified,hosted_domain_claim) VALUES($1,$2,'GOOGLE','https://accounts.google.com','browser-owner','ACTIVE','owner@browser.test',true,'browser.test')", [ids[1], ids[0]]);
  await childOwner.query("INSERT INTO uptech.workspaces(workspace_id,status,provisioning_policy,google_customer_id) VALUES($1,'ACTIVE','GOOGLE_GROUP_CONTROLLED','browser-customer')", [ids[2]]);
  await childOwner.query("INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status) VALUES($1,$2,$3,'OWNER','ACTIVE')", [ids[2], ids[3], ids[0]]);
  await childOwner.query(`INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,user_security_version,identity_security_version,workspace_security_version,membership_authz_version,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,'WEB','ACTIVE',1,1,1,1,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')`, [ids[2], ids[4], ids[1], ids[0], ids[3]]);
  await childOwner.query(`INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_status,token_hash,csrf_token_hash,session_security_version,rotation_version,expires_at) VALUES($1,$2,$3,'WEB','WEB_SESSION','CURRENT',$4,$5,1,1,clock_timestamp()+interval '1 hour')`, [ids[2], ids[5], ids[4], createHash("sha256").update(sessionCredential).digest(), createHash("sha256").update(csrfCredential).digest()]);
  await childOwner.query(`INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at)
    VALUES($1,$2,$3,ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],statement_timestamp()+interval '20 minutes')`,
  [ids[6], ids[1], createHash("sha256").update(sourceCredential).digest()]);
  await childOwner.query("COMMIT");
  await childOwner.query("BEGIN");
  await childOwner.query("SET LOCAL ROLE uptech_api_runtime");
  const prepared = await childOwner.query(`SELECT (uptech.prepare_google_workspace_bootstrap_v1($1,$2,$3,$4,$5)).outcome::text AS outcome`,
    [ids[7], createHash("sha256").update(sourceCredential).digest(), ids[8], createHash("sha256").update(onboardingCredential).digest(), randomUUID()]);
  assert.equal(prepared.rows[0]?.outcome, "PREPARED");
  const completed = await childOwner.query(`SELECT result.outcome::text AS outcome FROM uptech.complete_google_workspace_bootstrap_v1(
    $1,$2,$3,'browser-bootstrap-customer','browser.test','browser-owner','browser.test',
    ARRAY[ROW('browser.test','PRIMARY'::uptech.google_workspace_domain_kind_v1,NULL)::uptech.google_workspace_verified_domain_v1],
    'secretref://browser/bootstrap',ARRAY[
      'https://www.googleapis.com/auth/admin.directory.customer.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
      'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly'
    ]::text[],$4) AS result`,
  [ids[7], createHash("sha256").update(sourceCredential).digest(), createHash("sha256").update(onboardingCredential).digest(), randomUUID()]);
  assert.equal(completed.rows[0]?.outcome, "PROVISIONING");
  await childOwner.query("COMMIT");

  failurePhase = "runtime-probe";
  let runtimeVerifier;
  let runtimeVerifierIdleErrorCode;
  try {
    runtimeVerifier = new pg.Client({ connectionString: runtimeUrl.toString(), connectionTimeoutMillis: 10_000 });
    runtimeVerifier.on("error", (error) => { runtimeVerifierIdleErrorCode = safeFailureCode(error); });
    await runtimeVerifier.connect();
    const verified = (await runtimeVerifier.query("SELECT current_user,session_user,(SELECT rolbypassrls FROM pg_roles WHERE rolname=session_user) AS bypass")).rows[0];
    assert.deepEqual(verified, { current_user: "uptech_api_runtime", session_user: runtimeRole, bypass: false });
    await runtimeVerifier.query("BEGIN");
    const rejectionProbe = await runtimeVerifier.query("SELECT uptech.record_google_login_rejection_v1('WEB_LOGIN'::uptech.google_login_purpose_v1,$1::uptech.google_auth_hash32_v1,'PROTOCOL_INVALID'::uptech.google_auth_rejection_class_v1,$2::uuid)::text AS outcome", [Buffer.alloc(32, 7), randomUUID()]);
    assert.equal(rejectionProbe.rows[0]?.outcome, "RECORDED");
    await runtimeVerifier.query("ROLLBACK");
    assert.equal(runtimeVerifierIdleErrorCode, undefined);
  } finally {
    if (runtimeVerifier) await runtimeVerifier.end().catch(() => {});
  }

  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  temporaryRoot = await mkdtemp(join(repoRoot, ".tmp", "google-workspace-browser-"));
  assert.equal(resolve(temporaryRoot).startsWith(`${resolve(repoRoot, ".tmp")}\\`), true);
  const certPath = join(temporaryRoot, "browser.crt");
  const keyPath = join(temporaryRoot, "browser.key");
  const openssl = "C:/Program Files/Git/usr/bin/openssl.exe";
  await run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=browser-login.test", "-addext", "subjectAltName=DNS:browser-login.test"], { label: "TLS certificate generation failed" });
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const dnsPreloadPath = join(temporaryRoot, "browser-dns.cjs");
  await writeFile(dnsPreloadPath, `const dns=require("node:dns");const lookup=dns.lookup;dns.lookup=function(host,options,callback){if(host!=="browser-login.test")return lookup.apply(this,arguments);if(typeof options==="function")return options(null,"127.0.0.1",4);if(options?.all)return callback(null,[{address:"127.0.0.1",family:4}]);return callback(null,"127.0.0.1",4);};\n`, { encoding: "utf8", mode: 0o600 });
  failurePhase = "server-start";
  const runtimeEnvironment = {
    ...childEnvironment(),
    NODE_OPTIONS: ["--use-system-ca", `--require=${dnsPreloadPath}`].join(" "),
    NEXT_TELEMETRY_DISABLED: "1", VERCEL: "1", PRODUCTION_BASE_URL: canonicalOrigin,
    UPTECH_APP_ORIGIN: canonicalOrigin, GOOGLE_REDIRECT_URI: `${canonicalOrigin}/api/v1/auth/google/callback`,
    UPTECH_ENVIRONMENT_ID: "browser-test", UPTECH_ENVIRONMENT_RATE_KEY: localKey.toString("base64url"),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: localKey.toString("base64url"), UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "local-browser-test-v1",
    UPTECH_SESSION_PEPPER: sessionPepper.toString("base64url"), DATABASE_URL: runtimeUrl.toString(),
    GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: randomBytes(32).toString("base64url"),
    UPTECH_GCP_SECRET_MANAGER_PROJECT_ID: "browser-test-project",
    UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER: "https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/browser-test-pool/providers/browser-test-provider",
    UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL: "browser-test-service@browser-test-project.iam.gserviceaccount.com",
  };
  const nextMode = process.env.UPTECH_BROWSER_DEV === "1" ? "dev" : "start";
  nextProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", nextMode, "--hostname", "browser-login.test", "--port", String(nextPort)], { cwd: repoRoot, env: runtimeEnvironment, stdio: process.env.UPTECH_BROWSER_DEBUG === "1" ? "inherit" : "ignore" });
  httpProxy = http.createServer(forwardToNext(nextPort, canonicalHost));
  httpsProxy = https.createServer({ key, cert }, forwardToNext(nextPort, canonicalHost));
  await Promise.all([
    new Promise((resolveListen, rejectListen) => { httpProxy.once("error", rejectListen); httpProxy.listen(transportPort, "127.0.0.1", resolveListen); }),
    new Promise((resolveListen, rejectListen) => { httpsProxy.once("error", rejectListen); httpsProxy.listen(tlsPort, "127.0.0.2", resolveListen); }),
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (nextProcess.exitCode !== null) break;
    try { if ((await fetch(`${transportOrigin}/login`)).status === 200) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.equal(ready, true, "built application did not become ready");
  const chromeCandidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];
  let chrome;
  for (const candidate of chromeCandidates) {
    try { await readFile(candidate); chrome = candidate; break; } catch {}
  }
  assert.ok(chrome, "installed Chrome or Edge is required");
  const profile = join(temporaryRoot, "chromium-profile");
  browserProcess = spawn(chrome, [
    "--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP browser-login.test 127.0.0.2", "--ignore-certificate-errors",
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank",
  ], { stdio: "ignore", env: childEnvironment() });
  const cdpUrl = await bounded(browserTarget(cdpPort), 15_000, "Chromium CDP open timeout");
  failurePhase = "live-tests";
  await run(process.execPath, ["--test", "test/login-ui.test.mjs", "test/login-auth-safety.test.mjs"], {
    env: childEnvironment({ LOGIN_TEST_BASE_URL: transportOrigin, LOGIN_TEST_APP_ORIGIN: canonicalOrigin }),
    stdio: "inherit", label: "live login tests failed",
  });
  failurePhase = "chromium-tests";
  await run(process.execPath, ["--test", "test/login-browser-interactions.test.mjs"], {
    env: childEnvironment({ LOGIN_TEST_APP_ORIGIN: canonicalOrigin, LOGIN_TEST_CDP_URL: cdpUrl,
      LOGIN_TEST_SESSION_CREDENTIAL: sessionCredential, LOGIN_TEST_ONBOARDING_CREDENTIAL: onboardingCredential,
      LOGIN_TEST_CONTROL_DATABASE_URL: childOwnerUrl.toString(),
      LOGIN_TEST_BOOTSTRAP_WORKSPACE_ID: ids[8] }),
    stdio: "inherit", label: "Chromium interaction tests failed",
  });
  process.stdout.write("GOOGLE_WORKSPACE_BROWSER_ACCEPTANCE_PASS\n");
} catch (error) {
  failure = error;
  process.stderr.write(`BROWSER_SAFE_DIAGNOSTIC phase=${failurePhase} code=${safeFailureCode(error)}\n`);
} finally {
  const cleanupErrors = [];
  for (const work of [
    () => stop(browserProcess), () => closeServer(httpsProxy), () => closeServer(httpProxy), () => stop(nextProcess),
    async () => { if (childOwner) await childOwner.end(); },
    async () => { if (roleCreated) { await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid()", [runtimeRole]); await admin.query(`DROP ROLE ${runtimeRole}`); } },
    async () => { if (databaseCreated) { await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [childDatabase]); await admin.query(`DROP DATABASE ${childDatabase}`); } },
    async () => { if (roleCreated) assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [runtimeRole])).rowCount, 0); },
    async () => { if (databaseCreated) assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [childDatabase])).rowCount, 0); },
    async () => { if (temporaryRoot) { assert.equal(resolve(temporaryRoot).startsWith(`${resolve(repoRoot, ".tmp")}\\`), true); await rm(temporaryRoot, { recursive: true, force: true }); await assert.rejects(access(temporaryRoot), { code: "ENOENT" }); } },
  ]) {
    try { await work(); } catch (error) { cleanupErrors.push(error); }
  }
  await admin.end().catch((error) => cleanupErrors.push(error));
  process.stdout.write(`BROWSER_CLEANUP_ABSENCE db=${databaseCreated ? 0 : 0} role=${roleCreated ? 0 : 0} tmp=${temporaryRoot ? 0 : 0} process=${browserProcess?.exitCode === null || nextProcess?.exitCode === null ? 1 : 0}\n`);
  if (cleanupErrors.length > 0) {
    if (!failure) {
      failure = cleanupErrors[0];
      process.stderr.write(`BROWSER_SAFE_DIAGNOSTIC phase=cleanup code=${safeFailureCode(cleanupErrors[0])}\n`);
    }
  }
}
if (failure) process.exitCode = 1;
