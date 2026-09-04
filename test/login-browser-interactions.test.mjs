import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";

const appOrigin = process.env.LOGIN_TEST_APP_ORIGIN;
const cdpUrl = process.env.LOGIN_TEST_CDP_URL;
const sessionCredential = process.env.LOGIN_TEST_SESSION_CREDENTIAL;
const onboardingCredential = process.env.LOGIN_TEST_ONBOARDING_CREDENTIAL;
const controlDatabaseUrl = process.env.LOGIN_TEST_CONTROL_DATABASE_URL;
const bootstrapWorkspaceId = process.env.LOGIN_TEST_BOOTSTRAP_WORKSPACE_ID;
assert.ok(appOrigin, "LOGIN_TEST_APP_ORIGIN is required");
assert.ok(cdpUrl, "LOGIN_TEST_CDP_URL is required");
assert.match(sessionCredential ?? "", /^[A-Za-z0-9_-]{43}$/u);
assert.match(onboardingCredential ?? "", /^[A-Za-z0-9_-]{43}$/u);
assert.ok(controlDatabaseUrl, "LOGIN_TEST_CONTROL_DATABASE_URL is required");
assert.match(bootstrapWorkspaceId ?? "", /^[0-9a-f-]{36}$/u);

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }
  async open() {
    await Promise.race([new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    }), new Promise((_, reject) => setTimeout(() => reject(new Error("CDP open timed out")), 10_000))]);
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== undefined) {
        const callback = this.pending.get(message.id);
        if (callback) {
          this.pending.delete(message.id);
          if (message.error) callback.reject(new Error(message.error.message));
          else callback.resolve(message.result);
        }
        return;
      }
      const listeners = this.events.get(message.method) ?? [];
      for (const listener of listeners) listener(message.params ?? {});
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    this.events.set(method, [...(this.events.get(method) ?? []), listener]);
  }
  once(method, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP event timed out: ${method}`)), timeout);
      const listener = (params) => {
        clearTimeout(timer);
        this.events.set(method, (this.events.get(method) ?? []).filter((item) => item !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }
  close() { this.socket.close(); }
}

let cdp;
let control;
const exceptions = [];

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error("Browser evaluation failed");
  return result.result.value;
}

async function navigate(path, phase = "page") {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: new URL(path, appOrigin).href });
  try {
    await loaded;
  } catch {
    const state = await evaluate("({readyState:document.readyState,pathname:location.pathname})");
    throw new Error(`Browser navigation timed out: ${phase}; ready=${state.readyState}; pathMatch=${state.pathname === new URL(path, appOrigin).pathname}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function click(selector, existingPoint = null) {
  const point = existingPoint ?? await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element) return null; element.scrollIntoView({block:'center',inline:'center',behavior:'instant'}); const r=element.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2; const hit=document.elementFromPoint(x,y); return {x,y,visible:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:hit===element||element.contains(hit)}; })()`);
  assert.ok(point, `missing pointer target ${selector}`);
  assert.deepEqual({ visible: point.visible, hit: point.hit }, { visible: true, hit: true });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return point;
}

async function waitForBrowser(expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Browser condition timed out");
}

function browserPhase(phase) {
  process.stdout.write(`BROWSER_INTERACTION_PHASE ${phase}\n`);
}

before(async () => {
  control = new pg.Client({ connectionString: controlDatabaseUrl, connectionTimeoutMillis: 10_000 });
  await control.connect();
  cdp = new Cdp(cdpUrl);
  await cdp.open();
  cdp.on("Runtime.exceptionThrown", (event) => exceptions.push(event.exceptionDetails?.text ?? "runtime exception"));
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Network.enable")]);
});

after(async () => { cdp?.close(); await control?.end(); });

async function pauseOneRequest(pathFragment, method, activate) {
  let count = 0;
  let resolvePaused;
  const paused = new Promise((resolve) => { resolvePaused = resolve; });
  cdp.on("Fetch.requestPaused", (event) => {
    const destination = new URL(event.request.url);
    if (destination.origin !== appOrigin || destination.pathname !== pathFragment) return;
    count += 1;
    browserPhase("request-paused");
    if (count === 1) resolvePaused(event);
  });
  browserPhase("fetch-enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*${pathFragment}*`, requestStage: "Request" }] });
  const pendingObserved = evaluate(`new Promise((resolve) => {
    const observe = () => {
      const button = document.querySelector('button[aria-busy=true]:disabled');
      if (button) { observer.disconnect(); resolve(true); }
    };
    const observer = new MutationObserver(observe);
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-busy', 'disabled'] });
    observe();
  })`);
  browserPhase("activation-start");
  await activate();
  browserPhase("activation-complete");
  const event = await Promise.race([paused, new Promise((_, reject) => setTimeout(() => reject(new Error("expected request was not paused")), 10_000))]);
  assert.deepEqual({ method: event.request.method, origin: new URL(event.request.url).origin, path: new URL(event.request.url).pathname }, {
    method, origin: appOrigin, path: pathFragment,
  });
  browserPhase("pending-probe-start");
  assert.equal(await pendingObserved, true);
  browserPhase("pending-observed");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(count, 1);
  browserPhase("request-continue");
  await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  await cdp.send("Fetch.disable");
  browserPhase("fetch-disabled");
  return event;
}

test("real Chromium hydrates recovery actions, fixed help, and stale-session replay", async () => {
  const onboardingCookie = await cdp.send("Network.setCookie", {
    name: "__Host-uptech_onboarding", value: onboardingCredential, url: appOrigin,
    secure: true, httpOnly: true, sameSite: "Lax",
  });
  assert.equal(onboardingCookie.success, true);
  await navigate("/setup/provisioning", "provisioning-pending");
  assert.equal(await evaluate("document.querySelector('[role=status]')?.innerText.length > 20"), true);
  await pauseOneRequest("/api/v1/onboarding/google-workspace/status", "GET", async () => {
    await click("button[type=button]");
    await click("button[type=button]");
  });
  await waitForBrowser("location.pathname === '/setup/provisioning'");

  await control.query(`UPDATE uptech.sync_jobs SET status='LEASED',attempt_count=1,max_attempts=3,
    leased_at=statement_timestamp()-interval '3 minutes',lease_expires_at=statement_timestamp()-interval '1 minute',
    lease_owner='browser-test',lease_fence=gen_random_uuid(),updated_at=statement_timestamp()
    WHERE workspace_id=$1 AND job_kind='DIRECTORY_SYNC'`, [bootstrapWorkspaceId]);
  await navigate("/setup/provisioning", "provisioning-retry");
  const retryBefore = await evaluate("({timeOrigin:performance.timeOrigin,title:document.querySelector('h1')?.innerText})");
  await evaluate("document.documentElement.dataset.harnessDocument='retry-before'");
  assert.equal(await evaluate("document.querySelector('button[type=button]')?.innerText.length > 5"), true);
  let resolveRetryResponse;
  const retryResponse = new Promise((resolve) => { resolveRetryResponse = resolve; });
  cdp.on("Network.responseReceived", (event) => {
    const destination = new URL(event.response.url);
    if (destination.origin === appOrigin && destination.pathname === "/api/v1/onboarding/google-workspace/sync-retry") {
      resolveRetryResponse({ status: event.response.status, mimeType: event.response.mimeType });
    }
  });
  await pauseOneRequest("/api/v1/onboarding/google-workspace/sync-retry", "POST", async () => {
    await click("button[type=button]");
  });
  assert.deepEqual(await Promise.race([retryResponse, new Promise((_, reject) => setTimeout(() => reject(new Error("retry response timed out")), 10_000))]), {
    status: 200, mimeType: "application/json",
  });
  await waitForBrowser("document.documentElement.dataset.harnessDocument!=='retry-before'");
  assert.deepEqual(await evaluate(`({path:location.pathname,reRendered:document.querySelector('h1')?.innerText!==${JSON.stringify(retryBefore.title)},pendingState:Boolean(document.querySelector('[role=status]'))})`), {
    path: "/setup/provisioning", reRendered: true, pendingState: true,
  });
  assert.equal((await control.query("SELECT status FROM uptech.sync_jobs WHERE workspace_id=$1 AND job_kind='DIRECTORY_SYNC'", [bootstrapWorkspaceId])).rows[0]?.status, "QUEUED");

  await control.query(`UPDATE uptech.sync_jobs SET status='LEASED',attempt_count=max_attempts,
    leased_at=statement_timestamp()-interval '3 minutes',lease_expires_at=statement_timestamp()-interval '1 minute',
    lease_owner='browser-test',lease_fence=gen_random_uuid(),updated_at=statement_timestamp()
    WHERE workspace_id=$1 AND job_kind='DIRECTORY_SYNC'`, [bootstrapWorkspaceId]);
  await navigate("/setup/provisioning", "provisioning-support");
  assert.deepEqual(await evaluate(`(() => {
    const link=document.querySelector('a[href^="mailto:contact@uptech.vn"]');
    if(!link) return null;
    window.__uptechSupportActivation=0;
    document.addEventListener('click',(event)=>{if(event.target.closest('a')===link){event.preventDefault();window.__uptechSupportActivation+=1;}},{capture:true});
    return {fixedRecipient:link.getAttribute('href').startsWith('mailto:contact@uptech.vn?'),noReflection:!link.getAttribute('href').includes('tenant-b.example')};
  })()`), { fixedRecipient: true, noReflection: true });
  await click('a[href^="mailto:contact@uptech.vn"]');
  await waitForBrowser("Boolean(document.querySelector('textarea[readonly]'))");
  assert.deepEqual(await evaluate(`({
    activation:window.__uptechSupportActivation,
    stayed:location.pathname==='/setup/provisioning',
    fixedFallback:document.querySelector('textarea[readonly]')?.value.split('\\n')[0]==='contact@uptech.vn',
    noReflection:!document.querySelector('textarea[readonly]')?.value.includes('tenant-b.example')
  })`), { activation: 1, stayed: true, fixedFallback: true, noReflection: true });

  await control.query(`INSERT INTO uptech.people_sync_generations(
    workspace_id,id,connector_id,job_id,lease_fence,status,traversal_complete,started_at,completed_at,fresh_until,google_customer_id,primary_domain)
    SELECT job.workspace_id,gen_random_uuid(),job.connector_id,job.id,gen_random_uuid(),'PUBLISHED',true,
      statement_timestamp()-interval '1 minute',statement_timestamp(),statement_timestamp()+interval '1 hour',
      'browser-bootstrap-customer','tenant-a.example' FROM uptech.sync_jobs job
    WHERE job.workspace_id=$1 AND job.job_kind='DIRECTORY_SYNC'`, [bootstrapWorkspaceId]);
  await navigate("/setup/provisioning", "provisioning-ready");
  assert.equal(await evaluate("Boolean(document.querySelector('form[action=\"/api/v1/onboarding/google-workspace/finish\"]'))"), true);
  let resolveFinishNavigation;
  const finishNavigation = new Promise((resolve) => { resolveFinishNavigation = resolve; });
  cdp.on("Network.requestWillBeSent", (event) => {
    const destination = new URL(event.request.url);
    if (destination.origin !== "https://accounts.google.com") return;
    resolveFinishNavigation({
      destinationOrigin: destination.origin,
      destinationPath: destination.pathname,
      redirectStatus: event.redirectResponse?.status ?? null,
      redirectPath: event.redirectResponse === undefined ? null : new URL(event.redirectResponse.url).pathname,
    });
  });
  await pauseOneRequest("/api/v1/onboarding/google-workspace/finish", "POST", async () => {
    const finishPoint = await click('form[action="/api/v1/onboarding/google-workspace/finish"] button');
    await click('form[action="/api/v1/onboarding/google-workspace/finish"] button', finishPoint);
  });
  assert.deepEqual(await Promise.race([
    finishNavigation,
    new Promise((_, reject) => setTimeout(() => reject(new Error("finish navigation timed out")), 10_000)),
  ]), {
    destinationOrigin: "https://accounts.google.com",
    destinationPath: "/o/oauth2/v2/auth",
    redirectStatus: 303,
    redirectPath: "/api/v1/onboarding/google-workspace/finish",
  });
  const finishCookies = (await cdp.send("Network.getAllCookies")).cookies;
  assert.equal(finishCookies.filter(({ name }) => name === "__Host-uptech_onboarding").length, 0);
  assert.deepEqual(finishCookies.filter(({ name }) => name === "__Host-uptech_login_tx").map(({ secure, httpOnly }) => ({ secure, httpOnly })), [
    { secure: true, httpOnly: true },
  ]);
  await cdp.send("Page.stopLoading");

  for (const state of ["personal_account", "user_suspended", "workspace_suspended", "login_failed"]) {
    await navigate(`/login?error=${state}&request_id=00000000-0000-4000-8000-000000000091`, `recovery-${state}`);
    assert.equal(await evaluate("document.body.innerText.trim().length > 80"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('[data-testid=login-card]'))"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('[data-nextjs-dialog],#webpack-dev-server-client-overlay,.vite-error-overlay'))"), false);
    assert.equal(await evaluate("document.querySelectorAll('button,a,form').length > 1"), true);
  }

  await navigate("/login?error=personal_account");
  const helpResponses = [];
  cdp.on("Network.responseReceived", (event) => {
    if (new URL(event.response.url).pathname === "/help/enterprise-login") helpResponses.push(event.response.status);
  });
  await click('a[href="/help/enterprise-login"]');
  await waitForBrowser("location.pathname === '/help/enterprise-login'");
  assert.equal(helpResponses.includes(200), true);
  assert.equal(await evaluate("location.pathname"), "/help/enterprise-login");
  assert.equal(await evaluate("document.body.innerText.includes('tenant-b.example')"), false);

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});",
  });
  await navigate("/login?error=user_suspended");
  await click("button[type=button]");
  assert.equal(await evaluate("Boolean(document.querySelector('textarea[readonly]'))"), true);

  await navigate("/login?error=workspace_suspended&request_id=00000000-0000-4000-8000-000000000091");
  await click('a[href^="mailto:contact@uptech.vn"]');
  assert.equal(await evaluate("document.querySelector('textarea[readonly]')?.value.includes('contact@uptech.vn')"), true);

  for (const path of ["/help/enterprise-login", "/help/google-workspace/domain-verification"]) {
    await navigate(`${path}?domain=tenant-b.example&returnUrl=${encodeURIComponent("https://tenant-b.example/takeover")}`);
    assert.equal(await evaluate("document.querySelector('main').innerText.includes('tenant-b.example')"), false);
    const hrefs = await evaluate("Array.from(document.querySelectorAll('main a')).map(a=>a.getAttribute('href')).sort()");
    assert.deepEqual(hrefs, path.includes("domain-verification")
      ? ["/login", "https://admin.google.com/ac/domains/manage"]
      : ["/login"]);
  }

  const seededCookie = await cdp.send("Network.setCookie", {
    name: "__Host-uptech_session",
    value: sessionCredential,
    url: appOrigin,
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
  assert.equal(seededCookie.success, true);
  await navigate("/login");
  assert.equal((await cdp.send("Network.getCookies", { urls: [appOrigin] })).cookies.filter(({ name }) => name === "__Host-uptech_session").length, 1);
  const requests = [];
  const responses = [];
  cdp.on("Network.requestWillBeSentExtraInfo", (event) => {
    const request = [...requests].reverse().find(({ requestId, fetchSite }) => requestId === event.requestId && fetchSite === null);
    if (request) request.fetchSite = event.headers["sec-fetch-site"] ?? event.headers["Sec-Fetch-Site"] ?? null;
  });
  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.redirectResponse?.url.includes("/api/v1/auth/google/transactions")) {
      responses.push(event.redirectResponse.status);
    }
    if (event.request.url.includes("/api/v1/auth/google/transactions")) {
      requests.push({
        requestId: event.requestId,
        method: event.request.method,
        bodyHash: createHash("sha256").update(event.request.postData ?? "").digest("hex"),
        bodyShape: [...new URLSearchParams(event.request.postData ?? "").keys()].sort(),
        bodyBytes: Buffer.byteLength(event.request.postData ?? "", "utf8"),
        originMatch: event.request.headers.Origin === appOrigin,
        fetchSite: event.request.headers["Sec-Fetch-Site"] ?? null,
      });
    }
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://accounts.google.com/*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", (event) => void cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }));
  await click('button[data-testid="google-login-submit"]');
  for (let attempt = 0; attempt < 100 && requests.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  const cookies = (await cdp.send("Network.getCookies", { urls: [appOrigin] })).cookies;
  assert.deepEqual({
    requestMethods: requests.map(({ method }) => method),
    responseStatuses: responses,
    pathname: await evaluate("location.pathname"),
    errorState: await evaluate("new URL(location.href).searchParams.get('error')"),
    originMatches: requests.map(({ originMatch }) => originMatch),
    fetchSites: requests.map(({ fetchSite }) => fetchSite),
    webCookieCount: cookies.filter(({ name }) => name === "__Host-uptech_session").length,
    loginCookieCount: cookies.filter(({ name }) => name === "__Host-uptech_login_tx").length,
  }, {
    requestMethods: ["POST", "POST"],
    responseStatuses: [307, 303],
    pathname: "/login",
    errorState: null,
    originMatches: [true, true],
    fetchSites: ["same-origin", "same-origin"],
    webCookieCount: 0,
    loginCookieCount: 1,
  });
  assert.equal(requests[0].bodyHash, requests[1].bodyHash);
  assert.deepEqual(requests.map(({ bodyShape }) => bodyShape), [["intent"], ["intent"]]);
  assert.equal(requests.every(({ bodyBytes }) => bodyBytes > 0 && bodyBytes < 128), true);
  assert.equal(cookies.filter(({ name }) => name === "__Host-uptech_session").length, 0);
  const loginCookies = cookies.filter(({ name }) => name === "__Host-uptech_login_tx");
  assert.equal(loginCookies.length, 1);
  assert.equal(loginCookies[0].secure, true);
  assert.equal(loginCookies[0].httpOnly, true);
  assert.deepEqual(exceptions, []);
});
