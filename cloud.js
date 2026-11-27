/* Quaderno — storage layer.
   - Microsoft sign-in in the browser: OAuth 2.0 authorization code flow with PKCE (no secret, no server).
   - Microsoft Graph: the app only asks for its own OneDrive folder (Files.ReadWrite.AppFolder),
     which OneDrive shows as "App/Quaderno" (or "Apps/Quaderno").
     Layout inside it:  items/<id>.json   one file per note, notebook, task, event, preference
                        files/<name>      images and attachments
                        Leggibili/…       a readable .html copy of every note, by notebook
   - IndexedDB: a copy of everything on this device, so the app opens instantly and works offline. */
(() => {
"use strict";
const CFG = window.QUADERNO_CONFIG || {};
const AUTHORITY = String(CFG.authority || "https://login.microsoftonline.com/common").replace(/\/+$/, "");
const SCOPES = "openid profile offline_access Files.ReadWrite.AppFolder";
// Outlook calendar, read-only. Asked at every interactive sign-in, used with its own token,
// so syncing the notes keeps working even if this permission has not been given yet.
const CAL_SCOPES = "openid offline_access Calendars.Read";
const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKENS_KEY = "quaderno.auth";
const PKCE_KEY = "quaderno.pkce";
const SIMPLE_MAX = 4 * 1024 * 1024 - 1024;      // Graph simple upload limit
const CHUNK = 320 * 1024 * 16;                   // upload session chunks: a multiple of 320 KiB

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra || {});
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/i, "");
const b64url = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = (s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
function jwtPayload(t) {
  try {
    let p = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    p += "===".slice(0, (4 - (p.length % 4)) % 4);
    const bin = atob(p), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) { return {}; }
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };

/* ---------- sign-in ---------- */
const Auth = {
  tokens: null,
  refreshing: null,
  get configured() { return !!CFG.clientId; },
  get account() { return (this.tokens && this.tokens.account) || null; },
  get signedIn() { return !!(this.tokens && this.tokens.refresh); },
  load() { try { this.tokens = JSON.parse(lsGet(TOKENS_KEY) || "null"); } catch (e) { this.tokens = null; } return this.tokens; },
  save(t) { this.tokens = t; lsSet(TOKENS_KEY, t ? JSON.stringify(t) : null); },

  /* Leaves the page for Microsoft's sign-in page. silent: try without showing anything (prompt=none). */
  async signIn({ silent = false, hint = "" } = {}) {
    if (!this.configured) throw fail("not_configured", "Manca il clientId in config.js");
    const verifier = randomString(48), state = randomString(16);
    try { sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, silent })); } catch (e) {}
    const q = new URLSearchParams({
      client_id: CFG.clientId, response_type: "code", redirect_uri: redirectUri(), response_mode: "query",
      scope: silent ? SCOPES : SCOPES + " Calendars.Read", state, code_challenge: b64url(await sha256(verifier)), code_challenge_method: "S256",
      prompt: silent ? "none" : "select_account",
    });
    if (hint) q.set("login_hint", hint);
    location.assign(AUTHORITY + "/oauth2/v2.0/authorize?" + q);
  },

  /* Call once at start-up. null: the page was not opened by a sign-in redirect. */
  async handleRedirect() {
    const p = new URLSearchParams(location.search);
    if (!p.has("code") && !p.has("error")) return null;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || "null"); sessionStorage.removeItem(PKCE_KEY); } catch (e) {}
    history.replaceState(null, "", redirectUri() + location.hash);
    if (!saved || p.get("state") !== saved.state) return { error: "state_mismatch", description: "La risposta di accesso non corrisponde: riprova.", silent: !!(saved && saved.silent) };
    if (saved.purpose === "cal") return CalAuth.finish(p, saved);           // sign-in of the calendar account
    if (p.has("error")) return { error: p.get("error"), description: p.get("error_description") || "", silent: saved.silent };
    const r = await this.tokenRequest({ grant_type: "authorization_code", code: p.get("code"), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    return r.ok ? { ok: true, silent: saved.silent } : { error: r.error, description: r.description, silent: saved.silent };
  },

  async tokenRequest(params) {
    let res, j;
    try {
      res = await fetch(AUTHORITY + "/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CFG.clientId, scope: SCOPES, ...params }),
      });
      j = await res.json();
    } catch (e) { return { ok: false, error: "network" }; }
    if (!res.ok || !j.access_token) return { ok: false, error: j.error || "token_error", description: j.error_description || "" };
    const prev = this.tokens || {};
    const c = j.id_token ? jwtPayload(j.id_token) : null;
    const account = c ? { id: c.oid || c.sub || "", tid: c.tid || "", name: c.name || "", username: c.preferred_username || c.email || "" } : prev.account || null;
    this.save({ access: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000, refresh: j.refresh_token || prev.refresh || "", account });
    return { ok: true };
  },

  /* A valid access token; refreshes it when needed. Throws code "offline" or "reauth". */
  async token() {
    const t = this.tokens;
    if (!t || !t.refresh) throw fail("reauth");
    if (t.access && t.exp - 120000 > Date.now()) return t.access;
    if (!this.refreshing) this.refreshing = this.tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh }).finally(() => { this.refreshing = null; });
    const r = await this.refreshing;
    if (r.ok) return this.tokens.access;
    if (r.error === "network") throw fail("offline");
    throw fail("reauth", r.description);
  },
  expire() { if (this.tokens) this.tokens.exp = 0; },

  /* A token for the Outlook calendar. Throws code "cal_consent" when the user has not allowed it yet. */
  cal: null,
  calRefreshing: null,
  async calToken() {
    const t = this.tokens;
    if (!t || !t.refresh) throw fail("reauth");
    if (this.cal && this.cal.exp - 120000 > Date.now()) return this.cal.access;
    if (!this.calRefreshing) this.calRefreshing = (async () => {
      let res, j;
      try {
        res = await fetch(AUTHORITY + "/oauth2/v2.0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: CFG.clientId, scope: CAL_SCOPES, grant_type: "refresh_token", refresh_token: this.tokens.refresh }),
        });
        j = await res.json();
      } catch (e) { throw fail("offline"); }
      if (!res.ok || !j.access_token) {
        const why = (j.error || "") + " " + (j.error_description || "");
        throw fail(/consent|AADSTS65001|interaction_required|invalid_scope|AADSTS70011/i.test(why) ? "cal_consent" : /invalid_grant/i.test(why) ? "reauth" : "cal_error", j.error_description || j.error || "");
      }
      this.cal = { access: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 };
      if (j.refresh_token) this.save({ ...this.tokens, refresh: j.refresh_token });
      return j.access_token;
    })().finally(() => { this.calRefreshing = null; });
    return this.calRefreshing;
  },
  signOutUrl() { return AUTHORITY + "/oauth2/v2.0/logout?post_logout_redirect_uri=" + encodeURIComponent(redirectUri()); },
};

/* ---------- calendar account ----------
   The Outlook calendar can come from a different Microsoft account than the notes (OneDrive).
   Its tokens live apart ("quaderno.calauth") and only carry Calendars.Read. */
const CAL_TOKENS_KEY = "quaderno.calauth";
const CAL_SIGNIN = "openid profile offline_access Calendars.Read";
const CalAuth = {
  tokens: null,
  refreshing: null,
  get connected() { return !!(this.tokens && this.tokens.refresh); },
  get account() { return (this.tokens && this.tokens.account) || null; },
  load() { try { this.tokens = JSON.parse(lsGet(CAL_TOKENS_KEY) || "null"); } catch (e) { this.tokens = null; } return this.tokens; },
  save(t) { this.tokens = t; lsSet(CAL_TOKENS_KEY, t ? JSON.stringify(t) : null); },
  signOut() { this.save(null); },

  /* Leaves the page for Microsoft: the user picks any account. silent: renew without showing anything. */
  async signIn({ silent = false, hint = "" } = {}) {
    if (!CFG.clientId) throw fail("not_configured", "Manca il clientId in config.js");
    const verifier = randomString(48), state = randomString(16);
    try { sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, silent, purpose: "cal" })); } catch (e) {}
    const q = new URLSearchParams({
      client_id: CFG.clientId, response_type: "code", redirect_uri: redirectUri(), response_mode: "query",
      scope: CAL_SIGNIN, state, code_challenge: b64url(await sha256(verifier)), code_challenge_method: "S256",
      prompt: silent ? "none" : "select_account",
    });
    if (hint) q.set("login_hint", hint);
    location.assign(AUTHORITY + "/oauth2/v2.0/authorize?" + q);
  },
  async finish(p, saved) {
    if (p.has("error")) return { calendar: true, error: p.get("error"), description: p.get("error_description") || "", silent: !!saved.silent };
    const r = await this.tokenRequest({ grant_type: "authorization_code", code: p.get("code"), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    return r.ok ? { calendar: true, ok: true, silent: !!saved.silent } : { calendar: true, error: r.error, description: r.description, silent: !!saved.silent };
  },
  async tokenRequest(params) {
    let res, j;
    try {
      res = await fetch(AUTHORITY + "/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CFG.clientId, scope: CAL_SIGNIN, ...params }),
      });
      j = await res.json();
    } catch (e) { return { ok: false, error: "network" }; }
    if (!res.ok || !j.access_token) return { ok: false, error: j.error || "token_error", description: j.error_description || "" };
    const prev = this.tokens || {};
    const cl = j.id_token ? jwtPayload(j.id_token) : null;
    const account = cl ? { id: cl.oid || cl.sub || "", name: cl.name || "", username: cl.preferred_username || cl.email || "" } : prev.account || null;
    this.save({ access: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000, refresh: j.refresh_token || prev.refresh || "", account });
    return { ok: true };
  },
  async token() {
    const t = this.tokens;
    if (!t || !t.refresh) throw fail("reauth");
    if (t.access && t.exp - 120000 > Date.now()) return t.access;
    if (!this.refreshing) this.refreshing = this.tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh }).finally(() => { this.refreshing = null; });
    const r = await this.refreshing;
    if (r.ok) return this.tokens.access;
    if (r.error === "network") throw fail("offline");
    throw fail(/consent|AADSTS65001/i.test(r.error + " " + r.description) ? "cal_consent" : "reauth", r.description);
  },
  expire() { if (this.tokens) this.tokens.exp = 0; },
};
CalAuth.load();

/* ---------- Microsoft Graph ---------- */
async function graph(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const url = /^https:/.test(path) ? path : GRAPH + path;
  for (let attempt = 0; ; attempt++) {
    const tok = await Auth.token();
    let res;
    try { res = await fetch(url, { method, body, headers: { Authorization: "Bearer " + tok, ...headers } }); }
    catch (e) { throw fail("offline"); }
    if (res.status === 401 && attempt === 0) { Auth.expire(); continue; }
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
      const ra = +res.headers.get("Retry-After");
      await sleep(Math.min(ra > 0 ? ra : 2 ** attempt * 2, 60) * 1000);
      continue;
    }
    if (raw) return res;
    if (!res.ok) {
      let j = null; try { j = await res.json(); } catch (e) {}
      const err = j && j.error;
      throw fail((err && err.code) || "http_" + res.status, (err && err.message) || "Errore " + res.status, { status: res.status });
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : res.text();
  }
}

/* ---------- OneDrive app folder ---------- */
const encPath = (p) => String(p).split("/").map(encodeURIComponent).join("/");
const ROOT = "/me/drive/special/approot";
const Drive = {
  at: (p) => `${ROOT}:/${encPath(p)}`,
  info() { return graph(ROOT + "?$select=id,name,webUrl"); },
  meta(p) { return graph(this.at(p)); },

  /* All files in a folder (follows paging). [] when the folder does not exist yet. */
  async list(folder) {
    const out = [];
    let url = `${this.at(folder)}:/children?$top=999`;
    while (url) {
      let j;
      try { j = await graph(url); } catch (e) { if (e.status === 404) return out; throw e; }
      out.push(...(j.value || []));
      url = j["@odata.nextLink"] || null;
    }
    return out;
  },

  /* Downloads a driveItem (from list/meta) or a path. */
  async download(itemOrPath) {
    let item = itemOrPath;
    if (typeof item === "string") {
      try { item = await this.meta(item); } catch (e) { if (e.status === 404) return null; throw e; }
    }
    const direct = item["@microsoft.graph.downloadUrl"];
    if (direct) {
      try { const r = await fetch(direct); if (r.ok) return r.blob(); } catch (e) {}
    }
    const r = await graph(`/me/drive/items/${encodeURIComponent(item.id)}/content`, { raw: true });
    if (r.status === 404) return null;
    if (!r.ok) throw fail("http_" + r.status, "Download non riuscito", { status: r.status });
    return r.blob();
  },
  async downloadText(item) { const b = await this.download(item); return b ? b.text() : null; },

  /* Writes a file (creating folders as needed); returns the driveItem. ifMatch: eTag for conflict detection. */
  async put(p, data, { ifMatch = "", contentType = "application/octet-stream" } = {}) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: contentType });
    if (blob.size > SIMPLE_MAX) return this.putLarge(p, blob);
    const headers = { "Content-Type": blob.type || contentType };
    if (ifMatch) headers["If-Match"] = ifMatch;
    return graph(`${this.at(p)}:/content`, { method: "PUT", body: blob, headers });
  },
  putJson(p, obj, opts = {}) { return this.put(p, JSON.stringify(obj), { ...opts, contentType: "application/json" }); },
  async putLarge(p, blob) {
    const s = await graph(`${this.at(p)}:/createUploadSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) });
    let last = null;
    for (let off = 0; off < blob.size; off += CHUNK) {
      const end = Math.min(off + CHUNK, blob.size);
      let res;
      for (let attempt = 0; ; attempt++) {
        try { res = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${off}-${end - 1}/${blob.size}` }, body: blob.slice(off, end) }); }
        catch (e) { if (attempt < 3) { await sleep(1500 * (attempt + 1)); continue; } throw fail("offline"); }
        if ((res.status >= 500 || res.status === 429) && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
        break;
      }
      if (!res.ok) throw fail("upload_failed", "Caricamento non riuscito", { status: res.status });
      last = res;
    }
    return last.json();
  },
  async remove(p) {
    try { await graph(this.at(p), { method: "DELETE" }); }
    catch (e) { if (e.status !== 404) throw e; }
  },
};

/* ---------- IndexedDB (falls back to memory if the browser refuses it) ---------- */
const STORES = ["items", "blobs", "meta"];
const IDB = {
  db: null,
  mem: null,
  async open(name) {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open(name || "quaderno", 1);
        r.onupgradeneeded = () => STORES.forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error("blocked"));
      });
      return true;
    } catch (e) {
      this.mem = Object.fromEntries(STORES.map((s) => [s, new Map()]));
      return false;
    }
  },
  req(store, mode, fn) {
    if (this.mem) return Promise.resolve(fn(null, this.mem[store]));
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode), st = tx.objectStore(store);
      let out;
      const r = fn(st);
      if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  get(store, k) { return this.req(store, "readonly", (s, m) => (m ? m.get(k) : s.get(k))); },
  set(store, k, v) { return this.req(store, "readwrite", (s, m) => (m ? void m.set(k, v) : s.put(v, k))); },
  del(store, k) { return this.req(store, "readwrite", (s, m) => (m ? void m.delete(k) : s.delete(k))); },
  clear(store) { return this.req(store, "readwrite", (s, m) => (m ? void m.clear() : s.clear())); },
  async entries(store) {
    if (this.mem) return [...this.mem[store]];
    const [keys, vals] = await Promise.all([this.req(store, "readonly", (s) => s.getAllKeys()), this.req(store, "readonly", (s) => s.getAll())]);
    return keys.map((k, i) => [k, vals[i]]);
  },
  async wipe() { for (const s of STORES) await this.clear(s); },
};

/* ---------- Outlook calendar (read-only) ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
const ymdL = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const hmL = (d) => pad2(d.getHours()) + ":" + pad2(d.getMinutes());
async function calFetch(url, which) {
  const other = which === "other";
  for (let attempt = 0; ; attempt++) {
    const tok = other ? await CalAuth.token() : await Auth.calToken();
    let res;
    try { res = await fetch(url, { headers: { Authorization: "Bearer " + tok } }); }
    catch (e) { throw fail("offline"); }
    if (res.status === 401 && attempt === 0) { if (other) CalAuth.expire(); else Auth.cal = null; continue; }
    if (res.status === 403) throw fail("cal_consent");
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw fail("cal_error", "Errore " + res.status, { status: res.status });
    return res.json();
  }
}
/* Graph gives times in UTC: they become local day and hour here. All-day events keep their own dates. */
function normEvent(ev) {
  const st = ev.start || {}, en = ev.end || {};
  if (!st.dateTime) return null;
  const base = { id: ev.id, title: ev.subject || "(senza titolo)", location: (ev.location && ev.location.displayName) || "", link: ev.webLink || "" };
  if (ev.isAllDay) {
    const d = st.dateTime.slice(0, 10), last = new Date((en.dateTime || st.dateTime).slice(0, 10) + "T12:00:00");
    last.setDate(last.getDate() - 1);
    const endDate = ymdL(last) < d ? d : ymdL(last);
    return { ...base, allDay: true, date: d, endDate, time: "", endTime: "" };
  }
  const s = new Date(st.dateTime.replace(/\.\d+$/, "") + "Z"), e = new Date((en.dateTime || st.dateTime).replace(/\.\d+$/, "") + "Z");
  return { ...base, allDay: false, date: ymdL(s), endDate: e > s ? ymdL(new Date(e - 1)) : ymdL(s), time: hmL(s), endTime: hmL(e) };
}
const Cal = {
  /* Appointments from day `from` (included) to day `to` (excluded), "YYYY-MM-DD" in local time. */
  async view(from, to, which) {
    const s = new Date(from + "T00:00:00").toISOString(), e = new Date(to + "T00:00:00").toISOString();
    let url = `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(s)}&endDateTime=${encodeURIComponent(e)}&$select=id,subject,start,end,isAllDay,isCancelled,location,webLink&$orderby=start/dateTime&$top=200`;
    const out = [];
    for (let pages = 0; url && pages < 30; pages++) {
      const j = await calFetch(url, which);
      for (const ev of j.value || []) { if (ev.isCancelled) continue; const x = normEvent(ev); if (x) out.push(x); }
      url = j["@odata.nextLink"] || null;
    }
    return out;
  },
};

window.Cloud = { Auth, CalAuth, graph, Drive, IDB, redirectUri, Cal };
})();
