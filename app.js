(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $("#app"), noteList = $("#noteList"), edBody = $("#edBody"), edTitle = $("#edTitle"), pagePane = $("#pagePane");
const MAX_DOC = 3500000;                 // one OneDrive file per note (simple upload limit is 4 MB)
const MAX_FILE = 100 * 1024 * 1024;

const S = { items: new Map(), filter: { type: "all" }, query: "", sort: "updated", activeId: null, readOnly: false, ready: false, me: null, myName: "", names: {}, cal: null, filesKind: "all", pageStale: false };

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isNarrow = () => window.matchMedia("(max-width: 680px)").matches;
const isDrawer = () => window.matchMedia("(max-width: 1000px)").matches;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const ic = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const byUpdated = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
const byName = (x, y) => (x.name || "").localeCompare(y.name || "", "it");
const fmtSize = (b) => !b ? "" : b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1).replace(".", ",") + " MB";
const extOf = (name) => { const m = /\.([a-z0-9]{1,6})$/i.exec(name || ""); return m ? m[1].toUpperCase() : "FILE"; };

const fTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
const fDay = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
const fFull = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" });
const fLong = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
const fMonth = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });
const fWhen = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const hm = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
const remLabel = (ts) => { const d = new Date(ts); return dueLabel(ymd(d)) + " " + hm(d); };
function relDate(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60) return "adesso";
  if (diff < 0) return fWhen.format(d);
  if (diff < 3600) return Math.floor(diff / 60) + " min fa";
  if (d.toDateString() === now.toDateString()) return "oggi, " + fTime.format(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "ieri, " + fTime.format(d);
  return d.getFullYear() === now.getFullYear() ? fDay.format(d) : fFull.format(d);
}
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const todayStr = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y || 1970, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
function dueLabel(s) {
  if (!s) return "";
  const t = todayStr();
  if (s === t) return "Oggi";
  if (s === addDays(t, 1)) return "Domani";
  if (s === addDays(t, -1)) return "Ieri";
  const d = parseYmd(s);
  return d.getFullYear() === new Date().getFullYear() ? fDay.format(d) : fFull.format(d);
}
function dueClass(s, done) { if (!s || done) return ""; const t = todayStr(); return s < t ? " late" : s === t ? " today" : ""; }

const parseCache = new Map();
function parsed(id, html) {
  const c = parseCache.get(id);
  if (c && c.html === html) return c;
  const t = document.createElement("template");
  t.innerHTML = html || "";
  const atts = [];
  t.content.querySelectorAll("img, a[data-asset], a[data-od]").forEach((el) => {
    const od = el.dataset.od || "";
    if (el.tagName === "IMG") atts.push({ kind: "img", src: od ? "" : el.getAttribute("src") || "", od, name: el.getAttribute("alt") || "Immagine", asset: el.dataset.asset || "" });
    else atts.push({ kind: "doc", src: od ? "" : el.getAttribute("href") || "", od, name: el.dataset.name || el.textContent.trim() || "File", size: +el.dataset.size || 0, asset: el.dataset.asset || "" });
  });
  const firstImg = atts.find((a) => a.kind === "img");
  const img = firstImg ? { src: firstImg.od ? "od:" + firstImg.od : firstImg.src } : null;
  const links = [...new Set([...t.content.querySelectorAll("a[data-note]")].map((a) => a.dataset.note))];
  t.content.querySelectorAll("p,li,h1,h2,h3,div,blockquote,pre,br,tr,td,th").forEach((e) => e.append(" "));
  const out = { html, text: (t.content.textContent || "").replace(/\s+/g, " ").trim(), img: img ? img.src : null, atts, links };
  parseCache.set(id, out);
  return out;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

/* ---------- dialogs ---------- */
/* fields: [{name, label, type: text|date|time|select|checkbox, value, options:[{value,label}|{group, options}]}]
   extra: [{label, value, danger}] — extra buttons; resolves {action, values} or null. */
function dialog({ title, text = "", fields = [], ok = "OK", danger = false, extra = [], cancel = "Annulla" }) {
  return new Promise((resolve) => {
    closeMenu();
    const root = $("#modal"), form = $("#modalForm"), box = $("#modalFields"), okBtn = $("#modalOk"), ex = $("#modalExtra");
    $("#modalTitle").textContent = title;
    $("#modalText").textContent = text; $("#modalText").hidden = !text; $("#modalText").className = ""; okBtn.disabled = false;
    const opt = (o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`;
    box.innerHTML = fields.map((f, i) => {
      const id = "mf" + i;
      if (f.type === "checkbox") return `<label class="chk-l"><input type="checkbox" id="${id}"${f.value ? " checked" : ""}>${esc(f.label)}</label>`;
      const lab = f.label ? esc(f.label) : "";
      if (f.type === "select") return `<label class="fld">${lab}<select id="${id}">${f.options.map((o) => o.group ? `<optgroup label="${esc(o.group)}">${o.options.map(opt).join("")}</optgroup>` : opt(o)).join("")}</select></label>`;
      return `<label class="fld">${lab}<input id="${id}" type="${f.type || "text"}" value="${esc(f.value ?? "")}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""} autocomplete="off"${f.label ? "" : ' aria-label="Valore"'}></label>`;
    }).join("");
    fields.forEach((f, i) => { if (f.type === "select") $("#mf" + i).value = f.value ?? ""; });
    ex.innerHTML = extra.map((e, i) => `<button type="button" class="btn${e.danger ? " danger-o" : ""}" data-x="${i}">${esc(e.label)}</button>`).join("");
    okBtn.textContent = ok; okBtn.className = "btn " + (danger ? "danger" : "primary");
    $("#modalCancel").textContent = cancel;
    root.hidden = false;
    setTimeout(() => { const first = box.querySelector("input:not([type=checkbox]),select"); if (first) { first.focus(); if (first.select && first.type !== "date" && first.type !== "time") first.select(); } else okBtn.focus(); }, 0);
    const values = () => Object.fromEntries(fields.map((f, i) => { const el = $("#mf" + i); return [f.name, f.type === "checkbox" ? el.checked : el.value]; }));
    const done = (v) => { root.hidden = true; form.onsubmit = null; root.onclick = null; root.onkeydown = null; ex.onclick = null; resolve(v); };
    form.onsubmit = (e) => { e.preventDefault(); done({ action: "ok", values: values() }); };
    $("#modalCancel").onclick = () => done(null);
    ex.onclick = (e) => { const b = e.target.closest("[data-x]"); if (b) done({ action: extra[+b.dataset.x].value, values: values() }); };
    root.onclick = (e) => { if (e.target === root) done(null); };
    root.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
  });
}
async function ask({ title, text = "", input, ok = "OK", danger = false }) {
  const r = await dialog({ title, text, ok, danger, fields: input !== undefined ? [{ name: "v", value: input }] : [] });
  if (!r) return null;
  return input !== undefined ? String(r.values.v).trim() : true;
}

/* ---------- popover menu ---------- */
let popOff = null;
function openMenu(anchor, items, opts = {}) {
  closeMenu();
  items = items.filter(Boolean);
  if (!items.length) return;
  const pop = $("#pop");
  pop.innerHTML = items.map((it, i) => it === "-" ? "<hr>" : it.head ? `<div class="hd">${esc(it.head)}</div>` :
    `<button type="button" role="menuitem" data-i="${i}"${it.danger ? ' class="danger"' : ""}${it.disabled ? " disabled" : ""}>${it.swatch ? `<span class="sw ${it.swatch}"></span>` : it.icon ? ic(it.icon) : ""}<span>${esc(it.label)}</span>${it.k ? `<span class="k">${esc(it.k)}</span>` : ""}</button>`).join("");
  pop.hidden = false;
  let x, y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = opts.alignRight ? r.right - pop.offsetWidth : r.left;
    y = r.bottom + 4;
    if (y + pop.offsetHeight > innerHeight - 8) y = Math.max(8, r.top - pop.offsetHeight - 4);
  } else { x = anchor.x; y = anchor.y; if (y + pop.offsetHeight > innerHeight - 8) y = innerHeight - pop.offsetHeight - 8; }
  pop.style.left = Math.max(8, Math.min(x, innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.max(8, y) + "px";
  const first = pop.querySelector("button:not([disabled])");
  if (first) first.focus();
  pop.onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b || b.disabled) return; const it = items[+b.dataset.i]; closeMenu(); if (it.action) it.action(); };
  pop.onkeydown = (e) => {
    const bs = $$("button:not([disabled])", pop), k = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[(k + 1) % bs.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); bs[(k - 1 + bs.length) % bs.length].focus(); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); closeMenu(); if (anchor instanceof Element) anchor.focus(); }
  };
  const out = (e) => { if (!pop.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener("mousedown", out, true), 0);
  popOff = () => document.removeEventListener("mousedown", out, true);
}
function closeMenu() { const pop = $("#pop"); if (pop.hidden) return; pop.hidden = true; if (popOff) { popOff(); popOff = null; } }

/* ---------- storage ----------
   Every note, notebook, task, event and preference is one record. The copy on this device (IndexedDB)
   is what the app reads, so it opens instantly and keeps working offline. When signed in, records are
   kept in sync with the user's OneDrive app folder (items/<id>.json); images and attachments are files
   in files/. Without an account ("local" mode) everything stays on this device only. */
const Cloud = window.Cloud;
const idb = Cloud.IDB;
const sameMs = (a, b) => (a || 0) === (b || 0);
async function pool(list, n, fn) {
  let i = 0;
  const run = async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, run));
}
function saveBlob(filename, data, type = "text/plain;charset=utf-8") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const safeFile = (name) => (String(name || "file").normalize("NFC").replace(/[\\/:*?"<>|#%&{}~\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90).replace(/[. ]+$/, "") || "file");

const Store = {
  mode: "loading",               // "cloud" (OneDrive) | "local" (this device only)
  assets: null, user: null, sample: null, sharedOk: false,
  downloads: { save: async ({ filename, data }) => saveBlob(filename, data) },
  recs: new Map(),               // id -> { data, eTag, dirty, deleted, ver }
  pending: new Set(), inflight: new Set(), upq: [],
  syncing: false, again: false, lastSync: 0, lastPull: 0, offline: false, needAuth: false, syncErr: "", progress: "",
  pushTimer: null, loopTimer: null, persistOk: true,

  async init() {
    this.persistOk = await idb.open(window.QUADERNO_IDB_NAME || "quaderno");
    if (!this.persistOk) toast("Questo browser non permette di salvare dati sul dispositivo: le note restano solo finché la pagina è aperta.");
    let red = null;
    if (Cloud.Auth.configured) { try { red = await Cloud.Auth.handleRedirect(); } catch (e) { red = { error: "network" }; } }
    Cloud.Auth.load();
    if (red && red.ok) { try { sessionStorage.removeItem("quaderno.silent"); } catch (e) {} }
    if (Cloud.Auth.configured && Cloud.Auth.signedIn) {
      if (red && red.error && red.silent) this.needAuth = true;     // the quiet re-login did not work: ask later
      return this.start("cloud");
    }
    if (lsGet("quaderno.mode") === "local") return this.start("local");
    showWelcome(red && red.error ? "Accesso non riuscito: " + (red.description || red.error).split("\n")[0].slice(0, 220) : "");
  },

  async start(mode) {
    this.mode = mode;
    hideWelcome();
    if (mode === "cloud") {
      const acc = Cloud.Auth.account || {};
      S.me = acc.id || "me"; S.myName = acc.name || acc.username || "";
      const prev = await idb.get("meta", "account");
      if (prev && prev !== S.me) await this.wipeLocal();          // someone else's copy on this device
      await idb.set("meta", "account", S.me);
      lsSet("quaderno.mode", "cloud");
    } else { S.me = "local"; S.myName = ""; }
    this.assets = Files;
    await this.loadCache();
    if (mode === "cloud" && !(await idb.get("meta", "linked"))) {
      // First sign-in on this device: whatever was written here before (local mode) goes to OneDrive too.
      for (const [id, rec] of this.recs) if (!rec.eTag) { rec.dirty = true; this.pending.add(id); await idb.set("items", id, rec); if (rec.data && rec.data.kind === "note") OD.schedule(id); }
      await idb.set("meta", "linked", true);
    }
    onReady();
    if (mode === "cloud") {
      this.sync();
      this.loopTimer = setInterval(() => this.sync(), 60000);
      addEventListener("online", () => { this.offline = false; this.sync(); });
      addEventListener("offline", () => { this.offline = true; updateSync(); });
      document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - this.lastPull > 15000) this.sync(); });
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    updateSync();
  },

  async loadCache() {
    this.recs = new Map(); S.items = new Map(); this.pending = new Set();
    for (const [id, rec] of await idb.entries("items")) {
      if (!rec || typeof rec !== "object") continue;
      this.recs.set(id, rec);
      if (!rec.deleted && rec.data) S.items.set(id, rec.data);
      if (rec.dirty) this.pending.add(id);
    }
    this.upq = (await idb.get("meta", "upq")) || [];
  },
  async wipeLocal() {
    await idb.wipe();
    this.recs = new Map(); S.items = new Map(); this.pending = new Set(); this.upq = [];
    Files.forget();
  },

  put(id, data) {
    const clean = { ...data }; delete clean._shared; delete clean.id;
    const prev = S.items.get(id);
    S.items.set(id, clean);
    const old = this.recs.get(id) || {};
    const rec = { data: clean, eTag: old.eTag || null, dirty: true, deleted: false, ver: (old.ver || 0) + 1 };
    this.recs.set(id, rec); this.pending.add(id);
    idb.set("items", id, rec).catch(() => toast("Non riesco a salvare su questo dispositivo: lo spazio del browser è pieno o bloccato."));
    OD.onPut(id, clean, prev);
    this.schedulePush();
  },
  remove(id) {
    const prev = S.items.get(id);
    S.items.delete(id);
    const old = this.recs.get(id);
    if (!old || (!old.eTag && !this.inflight.has(id))) {
      this.recs.delete(id); this.pending.delete(id); idb.del("items", id).catch(() => {});
    } else {
      const rec = { data: null, eTag: old.eTag, dirty: true, deleted: true, ver: (old.ver || 0) + 1 };
      this.recs.set(id, rec); this.pending.add(id); idb.set("items", id, rec).catch(() => {});
    }
    if (prev && prev.kind === "note") OD.schedule(id);
    this.schedulePush();
  },
  schedulePush() {
    updateSync();
    if (this.mode !== "cloud") return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.sync({ pushOnly: true }), 1200);
  },
  async queueUpload(path) {
    if (!this.upq.includes(path)) this.upq.push(path);
    await idb.set("meta", "upq", this.upq);
    this.schedulePush();
  },

  async sync({ pushOnly = false } = {}) {
    if (this.mode !== "cloud" || this.needAuth) { updateSync(); return; }
    if (this.syncing) { this.again = true; return; }
    this.syncing = true; updateSync();
    try {
      await this.uploadFiles();
      await this.push();
      if (!pushOnly || Date.now() - this.lastPull > 60000) await this.pull();
      this.lastSync = Date.now(); this.offline = false; this.syncErr = "";
      OD.retryNow();
      try { sessionStorage.removeItem("quaderno.silent"); } catch (e) {}
    } catch (e) { this.syncFailed(e); }
    this.syncing = false; this.progress = "";
    if (this.again) { this.again = false; setTimeout(() => this.sync({ pushOnly: true }), 300); }
    updateSync(); OD.render();
  },
  syncFailed(e) {
    const code = e && e.code;
    if (code === "offline") { this.offline = true; return; }
    if (code === "reauth") {
      let tried = false;
      try { tried = sessionStorage.getItem("quaderno.silent") === "1"; sessionStorage.setItem("quaderno.silent", "1"); } catch (er) { tried = true; }
      if (!tried && !ed.dirty && $("#modal").hidden) {      // quietly renew the Microsoft sign-in (usually comes straight back)
        flushEditor();
        Cloud.Auth.signIn({ silent: true, hint: (Cloud.Auth.account || {}).username || "" }).catch(() => {});
        return;
      }
      this.needAuth = true; setBanner("");
      return;
    }
    if (code === "quotaLimitReached") this.syncErr = "OneDrive è pieno: libera spazio per continuare a salvare.";
    else this.syncErr = "Sincronizzazione non riuscita (" + (e && e.message ? String(e.message).slice(0, 80) : "errore") + "). Riprovo tra poco.";
  },

  async uploadFiles() {
    const list = [...this.upq];
    await pool(list, 3, async (path) => {
      const blob = await idb.get("blobs", path);
      if (blob) { this.progress = "Carico gli allegati su OneDrive…"; updateSync(); await Cloud.Drive.put(path, blob, { contentType: blob.type || "application/octet-stream" }); }
      this.upq = this.upq.filter((p) => p !== path);
      await idb.set("meta", "upq", this.upq);
    });
  },

  async push() {
    const ids = [...this.pending];
    let done = 0;
    await pool(ids, 4, async (id) => {
      const rec = this.recs.get(id);
      if (!rec || !rec.dirty) { this.pending.delete(id); return; }
      const ver = rec.ver, path = "items/" + id + ".json";
      this.inflight.add(id);
      if (ids.length > 10) { this.progress = `Salvo su OneDrive: ${++done} di ${ids.length}`; updateSync(); }
      try {
        if (rec.deleted) {
          await Cloud.Drive.remove(path);
          const cur = this.recs.get(id);
          if (cur && cur.ver === ver) { this.recs.delete(id); this.pending.delete(id); await idb.del("items", id); }
          return;
        }
        let item;
        try { item = await Cloud.Drive.putJson(path, rec.data, { ifMatch: rec.eTag || "" }); }
        catch (e) {
          if (e.status !== 412) throw e;
          // Changed on another device since this one last saw it: the most recent edit wins.
          const meta = await Cloud.Drive.meta(path).catch(() => null);
          const txt = meta ? await Cloud.Drive.downloadText(meta).catch(() => null) : null;
          let remote = null; try { remote = txt ? JSON.parse(txt) : null; } catch (er) {}
          if (remote && remote.kind && (remote.updatedAt || 0) > (rec.data.updatedAt || 0)) {
            const cur = this.recs.get(id);
            if (cur && cur.ver === ver) { this.applyRemote(id, remote, meta.eTag); this.pending.delete(id); renderAll(true); }
            return;
          }
          item = await Cloud.Drive.putJson(path, rec.data, {});
        }
        const cur = this.recs.get(id);
        if (!cur) return;
        cur.eTag = item && item.eTag || cur.eTag;
        if (cur.ver === ver) { cur.dirty = false; this.pending.delete(id); }
        await idb.set("items", id, cur);
      } finally { this.inflight.delete(id); }
    });
  },

  async pull() {
    const list = await Cloud.Drive.list("items");
    this.lastPull = Date.now();
    const remote = new Map();
    for (const it of list) { const m = /^([\w.~-]{1,200})\.json$/.exec(it.name || ""); if (m && it.file) remote.set(m[1], it); }
    let changed = 0;
    for (const [id, rec] of [...this.recs]) {
      if (rec.eTag && !rec.dirty && !remote.has(id)) { this.recs.delete(id); S.items.delete(id); await idb.del("items", id); changed++; }
    }
    const want = [];
    for (const [id, it] of remote) { const rec = this.recs.get(id); if (!rec || (!rec.dirty && rec.eTag !== it.eTag)) want.push([id, it]); }
    let done = 0;
    await pool(want, 6, async ([id, it]) => {
      const txt = await Cloud.Drive.downloadText(it);
      let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
      done++;
      if (!data || typeof data !== "object" || !data.kind) return;
      const cur = this.recs.get(id);
      if (cur && cur.dirty) return;                      // edited here meanwhile: this device's version is uploaded next
      this.applyRemote(id, data, it.eTag); changed++;
      if (want.length > 15) { this.progress = `Scarico da OneDrive: ${done} di ${want.length}`; updateSync(); if (done % 40 === 0) renderAll(true); }
    });
    if (changed) renderAll(true);
  },
  applyRemote(id, data, eTag) {
    const old = this.recs.get(id) || {};
    const rec = { data, eTag: eTag || null, dirty: false, deleted: false, ver: (old.ver || 0) + 1 };
    this.recs.set(id, rec); S.items.set(id, data);
    idb.set("items", id, rec).catch(() => {});
  },
};

/* ---------- images and attachments ----------
   In a note an image is <img data-od="files/…"> and a file is <a class="att" data-od="files/…">.
   The bytes live in OneDrive (files/…) and in this device's cache; the page shows them through blob: URLs,
   which are never saved into the note. */
const OD_PATH_RE = /^files\/[^/\\:*?"<>|#%]{1,200}$/;
const Files = {
  urls: new Map(),
  async upload(file) {
    const path = "files/" + newId("f") + "-" + safeFile(file.name);
    try { await idb.set("blobs", path, file); } catch (e) { throw Object.assign(new Error("cache"), { code: "quota_exceeded" }); }
    await Store.queueUpload(path);
    return { path, sizeBytes: file.size };
  },
  async blob(path) {
    let b = null;
    try { b = await idb.get("blobs", path); } catch (e) {}
    if (b) return b;
    if (Store.mode !== "cloud") return null;
    b = await Cloud.Drive.download(path);
    if (b) idb.set("blobs", path, b).catch(() => {});
    return b;
  },
  url(path) {
    if (!this.urls.has(path)) {
      const p = this.blob(path).then((b) => (b ? URL.createObjectURL(b) : null));
      this.urls.set(path, p);
      p.then((u) => { if (!u) this.urls.delete(path); }, () => this.urls.delete(path));
    }
    return this.urls.get(path);
  },
  forget() { for (const p of this.urls.values()) p.then((u) => u && URL.revokeObjectURL(u), () => {}); this.urls.clear(); },
};
function fillOd(img) {
  const p = img.dataset.od;
  if (!p || img.getAttribute("src")) return;
  Files.url(p).then((u) => { if (u && img.dataset.od === p && !img.getAttribute("src")) img.src = u; }).catch(() => {});
}
const odObserver = "IntersectionObserver" in window ? new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { odObserver.unobserve(en.target); fillOd(en.target); } }), { rootMargin: "300px" }) : null;
function hydrate(root, lazy) { root.querySelectorAll("img[data-od]:not([src])").forEach((img) => (lazy && odObserver ? odObserver.observe(img) : fillOd(img))); }
async function openAttachment(a) {
  const p = a.dataset.od, name = a.dataset.name || a.textContent.trim() || "file";
  if (!p) { if (a.href) openUrl(a.href); return; }
  toast("Apro “" + name + "”…");
  try {
    const b = await Files.blob(p);
    if (!b) { toast("Non trovo questo file: forse non è ancora stato caricato da un altro dispositivo."); return; }
    if (/^(image\/|application\/pdf|text\/plain|video\/|audio\/)/.test(b.type)) { const u = await Files.url(p); if (u) openUrl(u); }
    else saveBlob(name, b);
    $("#toast").hidden = true;
  } catch (e) { toast(e && e.code === "offline" ? "Sei offline e questo file non è sul dispositivo." : "Non riesco ad aprire il file."); }
}

function updateSync() {
  const dot = $("#syncDot"), txt = $("#syncText");
  const busy = Store.syncing || Store.pending.size > 0 || Store.upq.length > 0 || ed.dirty;
  dot.className = "dot";
  let t, cls = "ok";
  if (Store.mode === "loading") { txt.textContent = "Apro le note…"; return; }
  if (S.readOnly) { cls = "err"; t = "Sola lettura"; }
  else if (Store.mode === "local") { t = busy && ed.dirty ? "Salvataggio…" : "Salvato su questo dispositivo"; cls = busy && ed.dirty ? "busy" : "ok"; }
  else if (Store.needAuth) { cls = "err"; t = "Accedi di nuovo per sincronizzare"; }
  else if (Store.offline) { cls = "busy"; t = "Offline: salvo sul dispositivo"; }
  else if (Store.syncErr) { cls = "err"; t = Store.syncErr; }
  else if (Store.progress) { cls = "busy"; t = Store.progress; }
  else if (busy) { cls = "busy"; t = "Salvataggio su OneDrive…"; }
  else t = Store.lastSync ? "Sincronizzato con OneDrive" : "Collegamento a OneDrive…";
  dot.classList.add(cls);
  txt.textContent = t;
  dot.parentElement.title = t + (Store.lastSync ? " · ultima sincronizzazione " + relDate(Store.lastSync) : "");
  dot.parentElement.style.cursor = Store.needAuth ? "pointer" : "";
  const ss = $("#saveState");
  if (ss) ss.textContent = ed.dirty ? "Salvataggio…" : ed.id ? (Store.mode === "cloud" && (Store.pending.has(ed.id) || Store.offline) ? "Salvata sul dispositivo" : "Salvata") : "";
}
function setBanner(msg) { const b = $("#banner"); b.textContent = msg; b.hidden = !msg; }

function showWelcome(msg) {
  const w = $("#welcome");
  w.hidden = false;
  const conf = Cloud.Auth.configured;
  $("#btnSignIn").disabled = !conf;
  $("#welcomeMsg").textContent = msg || (conf ? "" : "Per salvare in OneDrive manca ancora il codice dell'app Microsoft nel file config.js (vedi LEGGIMI). Intanto puoi usare Quaderno solo su questo dispositivo.");
}
function hideWelcome() { $("#welcome").hidden = true; }

async function signOut() {
  flushEditor();
  const local = Store.mode === "local";
  const waiting = Store.pending.size + Store.upq.length;
  const ok = await ask({
    title: local ? "Cancellare le note da questo dispositivo?" : "Uscire da Quaderno?",
    text: local ? "In questa modalità le note esistono solo su questo dispositivo: verranno cancellate per sempre. Se vuoi tenerle, prima fai un Backup completo oppure collega OneDrive."
      : (waiting ? `Attenzione: ${waiting === 1 ? "1 modifica non è ancora arrivata" : waiting + " modifiche non sono ancora arrivate"} su OneDrive e andrebbe persa. ` : "Le tue note restano al sicuro nel tuo OneDrive. ") + "Da questo dispositivo verrà cancellata la copia delle note.",
    ok: local ? "Cancella" : "Esci", danger: local || !!waiting,
  });
  if (!ok) return;
  await Store.wipeLocal();
  lsSet("quaderno.mode", ""); lsSet("quaderno.last", "");
  if (local) { location.reload(); return; }
  Cloud.Auth.save(null);
  location.assign(Cloud.Auth.signOutUrl());
}
async function connectOneDrive() {
  if (!Cloud.Auth.configured) { toast("Manca il codice dell'app Microsoft in config.js: vedi LEGGIMI."); return; }
  flushEditor();
  try { await Cloud.Auth.signIn(); } catch (e) { toast("Accesso non disponibile."); }
}

async function loadMe() {}
async function resolveNames() {}
const personName = (id) => (id === S.me ? "te" : "qualcuno");

/* ---------- data access ---------- */
const all = (kind) => { const a = []; for (const [id, d] of S.items) if (d && d.kind === kind) a.push({ id, ...d }); return a; };
const notes = () => all("note");
const liveNotes = () => notes().filter((n) => !n.trashed && !n.isTemplate);
const notebooks = () => all("notebook").sort(byName);
const spaces = () => all("space").sort(byName);
const tasks = () => all("task");
const events = () => all("event");
const P = () => S.items.get("prefs") || {};
function setPrefs(patch) { if (S.readOnly) return; const cur = { ...P() }; delete cur._shared; Store.put("prefs", { ...cur, kind: "prefs", ...patch }); }
const nbName = (id) => { const n = S.items.get(id); return n && (n.kind === "notebook" || n.kind === "space") ? n.name || "Senza nome" : ""; };
const containerName = (n) => nbName(n.spaceId || n.notebookId);
const hasContainer = (n) => !!nbName(n.spaceId || n.notebookId);
const sharedOn = () => false;            // shared spaces need a shared server: not in the standalone app
/* An <img> for a note image, whatever its origin: OneDrive (od:…) or a web address. */
function imgTag(src, cls = "") {
  if (!src) return "";
  if (src.startsWith("od:")) return `<img${cls ? ` class="${cls}"` : ""} data-od="${esc(src.slice(3))}" alt="" loading="lazy">`;
  return /^https:/.test(src) ? `<img${cls ? ` class="${cls}"` : ""} src="${esc(src)}" alt="" loading="lazy">` : "";
}
function allTags() { const m = new Map(); liveNotes().forEach((n) => (n.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return m; }

function defaultNotebook() {
  if (S.filter.type === "notebook" && S.items.get(S.filter.id)) return S.filter.id;
  const nbs = notebooks().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (nbs.length) return nbs[0].id;
  const id = newId("b");
  Store.put(id, { kind: "notebook", name: "Il mio taccuino", createdAt: Date.now() });
  return id;
}
function containerForNew() {
  const f = S.filter;
  if (f.type === "space" && S.items.get(f.id)) return { spaceId: f.id, createdBy: S.me };
  return { notebookId: defaultNotebook() };
}

const PAGE_TYPES = new Set(["home", "tasks", "files", "calendar", "notebooks", "tags", "spaces"]);
const LIST_TYPES = new Set(["all", "starred", "reminders", "notebook", "tag", "templates", "shared", "space", "trash"]);
const activeReminders = () => liveNotes().filter((n) => n.reminder && !n.reminderDone).sort((a, b) => a.reminder - b.reminder);

/* Search syntax: words, "exact phrase", -exclude, tag:x (tag:x* prefix), -tag:x, taccuino:x / notebook:x,
   titolo:x / intitle:x, todo:true|false|*, promemoria:* / reminder:* */
function parseQuery(q) {
  const out = { terms: [], neg: [], tag: [], notebook: [], intitle: [], todo: null, reminder: false, empty: true };
  const re = /(-?)(?:(tag|notebook|taccuino|intitle|titolo|todo|promemoria|reminder):)?("([^"]*)"|\S+)/gi;
  let m;
  while ((m = re.exec(q || ""))) {
    const neg = !!m[1], key = (m[2] || "").toLowerCase();
    const val = norm(m[4] !== undefined ? m[4] : m[3]);
    out.empty = false;
    if (key === "tag") out.tag.push({ v: val, neg });
    else if (key === "notebook" || key === "taccuino") out.notebook.push(val);
    else if (key === "intitle" || key === "titolo") out.intitle.push(val);
    else if (key === "todo") out.todo = val;
    else if (key === "promemoria" || key === "reminder") out.reminder = true;
    else if (val) (neg ? out.neg : out.terms).push(val);
  }
  return out;
}
function matchQuery(n, q) {
  if (q.empty) return true;
  const tags = (n.tags || []).map(norm);
  for (const t of q.tag) {
    const hit = t.v.endsWith("*") ? tags.some((x) => x.startsWith(t.v.slice(0, -1))) : tags.includes(t.v);
    if (hit === t.neg) return false;
  }
  const nb = norm(containerName(n));
  if (q.notebook.some((v) => !nb.includes(v))) return false;
  const title = norm(n.title);
  if (q.intitle.some((v) => !title.includes(v))) return false;
  if (q.todo !== null) {
    const h = n.html || "";
    if (q.todo === "true" && !h.includes('data-checked="true"')) return false;
    if (q.todo === "false" && !h.includes('data-checked="false"')) return false;
    if (q.todo !== "true" && q.todo !== "false" && !h.includes("data-checked")) return false;
  }
  if (q.reminder && !(n.reminder && !n.reminderDone)) return false;
  if (q.terms.length || q.neg.length) {
    const hay = norm((n.title || "") + " " + parsed(n.id, n.html).text + " " + (n.tags || []).join(" ") + " " + containerName(n));
    if (!q.terms.every((t) => hay.includes(t))) return false;
    if (q.neg.some((t) => hay.includes(t))) return false;
  }
  return true;
}

function visibleNotes() {
  const f = S.filter;
  let arr = notes().filter((n) => (f.type === "trash" ? n.trashed : !n.trashed));
  if (f.type === "templates") arr = arr.filter((n) => n.isTemplate);
  else if (f.type !== "trash") arr = arr.filter((n) => !n.isTemplate);
  if (f.type === "starred") arr = arr.filter((n) => n.pinned);
  if (f.type === "reminders") arr = arr.filter((n) => n.reminder && !n.reminderDone);
  if (f.type === "notebook") arr = arr.filter((n) => n.notebookId === f.id && !n.spaceId);
  if (f.type === "space") arr = arr.filter((n) => n.spaceId === f.id);
  if (f.type === "tag") arr = arr.filter((n) => (n.tags || []).includes(f.tag));
  if (f.type === "shared") arr = arr.filter((n) => n._shared && n.createdBy && n.createdBy !== S.me);
  const q = parseQuery(S.query);
  if (!q.empty) arr = arr.filter((n) => matchQuery(n, q));
  if (f.type === "reminders") arr.sort((a, b) => a.reminder - b.reminder);
  else if (S.sort === "title") arr.sort((a, b) => (a.title || "￿").localeCompare(b.title || "￿", "it"));
  else if (S.sort === "created") arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  else arr.sort(byUpdated);
  return arr;
}

/* ---------- shortcuts ---------- */
function shortcutItems() {
  const out = [];
  liveNotes().filter((n) => n.pinned).sort(byUpdated).forEach((n) => out.push({ t: "note", id: n.id, label: n.title || "Senza titolo" }));
  const tags = allTags();
  (P().shortcuts || []).forEach((s) => {
    const it = S.items.get(s.id);
    if (s.t === "notebook" && it && it.kind === "notebook") out.push({ t: "notebook", id: s.id, label: nbName(s.id) });
    else if (s.t === "space" && it && it.kind === "space") out.push({ t: "space", id: s.id, label: nbName(s.id) });
    else if (s.t === "tag" && tags.has(s.id)) out.push({ t: "tag", id: s.id, label: s.id });
  });
  return out;
}
const isShortcut = (t, id) => (P().shortcuts || []).some((s) => s.t === t && s.id === id);
function toggleShortcut(t, id) {
  const cur = P().shortcuts || [];
  const on = isShortcut(t, id);
  setPrefs({ shortcuts: on ? cur.filter((s) => !(s.t === t && s.id === id)) : [...cur, { t, id }] });
  renderAll();
  toast(on ? "Tolto dalle scorciatoie" : "Aggiunto alle scorciatoie");
}
const scIcon = { note: "i-notes", notebook: "i-book", space: "i-space", tag: "i-tag" };
const scAttr = (s) => `data-${s.t === "notebook" ? "nb" : s.t}="${esc(s.id)}"`;

/* ---------- sidebar ---------- */
const SECTIONS = [
  { key: "home", label: "Home", icon: "i-home" },
  { key: "shortcuts", label: "Scorciatoie", icon: "i-star", kids: true },
  { key: "all", label: "Note", icon: "i-notes" },
  { key: "tasks", label: "Attività", icon: "i-task" },
  { key: "reminders", label: "Promemoria", icon: "i-bell" },
  { key: "files", label: "File", icon: "i-clip" },
  { key: "calendar", label: "Calendario", icon: "i-cal" },
  { key: "templates", label: "Modelli", icon: "i-tpl" },
  { key: "notebooks", label: "Taccuini", icon: "i-book", kids: true, add: "nb" },
  { key: "tags", label: "Tag", icon: "i-tag", kids: true },
  { key: "shared", label: "Condivisi con me", icon: "i-users", cloud: true },
  { key: "spaces", label: "Spazi", icon: "i-space", kids: true, add: "space", cloud: true },
  { key: "trash", label: "Cestino", icon: "i-trash" },
];
const SEC = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
const goFilter = (key) => (key === "shortcuts" ? { type: "starred" } : { type: key });
const openDefault = (k) => k !== "tags" && k !== "done";
function openMap() { try { return JSON.parse(lsGet("quaderno.open") || "{}") || {}; } catch (e) { return {}; } }
function isOpen(k) { const o = openMap(); return k in o ? !!o[k] : openDefault(k); }
function toggleOpen(k) { const o = openMap(); o[k] = !isOpen(k); lsSet("quaderno.open", JSON.stringify(o)); renderSidebar(); if (app.classList.contains("paged")) renderPage(true); }

function sectionActive(key) { const t = S.filter.type; return key === "shortcuts" ? t === "starred" : t === key; }
function sectionCount(key) {
  switch (key) {
    case "all": return liveNotes().length;
    case "tasks": return tasks().filter((t) => !t.done).length;
    case "reminders": return activeReminders().length;
    case "files": return liveNotes().reduce((s, n) => s + parsed(n.id, n.html).atts.length, 0);
    case "templates": return notes().filter((n) => n.isTemplate && !n.trashed).length;
    case "shared": return notes().filter((n) => n._shared && !n.trashed && !n.isTemplate && n.createdBy && n.createdBy !== S.me).length;
    case "trash": return notes().filter((n) => n.trashed).length;
    default: return 0;
  }
}
const kid = (attrs, icon, label, n, active) => `<button class="nav-item${active ? " active" : ""}" type="button" ${attrs} title="${esc(label)}">${ic(icon)}<span class="lbl">${esc(label)}</span>${n ? `<span class="n">${n}</span>` : ""}</button>`;

function kidsHtml(key) {
  const f = S.filter, live = liveNotes();
  if (key === "shortcuts") {
    const items = shortcutItems();
    if (!items.length) return `<div class="nav-empty">Tocca la stella in una nota, o usa il tasto destro su un taccuino o un tag.</div>`;
    return items.map((s) => kid(scAttr(s), scIcon[s.t], s.label, "",
      s.t === "note" ? S.activeId === s.id && LIST_TYPES.has(f.type) : s.t === "tag" ? f.type === "tag" && f.tag === s.id : (f.type === "notebook" || f.type === "space") && f.id === s.id)).join("");
  }
  if (key === "notebooks") {
    const nbs = notebooks();
    if (!nbs.length) return `<div class="nav-empty">Nessun taccuino.</div>`;
    const nbBtn = (nb) => kid(`data-nb="${esc(nb.id)}"`, "i-book", nb.name || "Senza nome", live.filter((n) => n.notebookId === nb.id && !n.spaceId).length || "", f.type === "notebook" && f.id === nb.id);
    const stacks = [...new Set(nbs.map((n) => n.stack).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
    let h = "";
    for (const st of stacks) {
      const op = isOpen("stack:" + st);
      h += `<div class="nav-row"><button class="caret" type="button" data-toggle="stack:${esc(st)}" aria-expanded="${op}" aria-label="${op ? "Comprimi" : "Espandi"} la pila ${esc(st)}">${ic("i-caret")}</button><button class="nav-item" type="button" data-stack="${esc(st)}" title="Pila: ${esc(st)}">${ic("i-stack")}<span class="lbl">${esc(st)}</span></button></div>`;
      if (op) h += `<div class="nav-kids">${nbs.filter((n) => n.stack === st).map(nbBtn).join("")}</div>`;
    }
    return h + nbs.filter((n) => !n.stack).map(nbBtn).join("");
  }
  if (key === "tags") {
    const m = allTags(), tags = [...m.keys()].sort((a, b) => a.localeCompare(b, "it"));
    return tags.length ? tags.map((t) => kid(`data-tag="${esc(t)}"`, "i-tag", t, m.get(t), f.type === "tag" && f.tag === t)).join("") : `<div class="nav-empty">I tag che aggiungi alle note compaiono qui.</div>`;
  }
  if (key === "spaces") {
    const sps = spaces();
    return sps.length ? sps.map((s) => kid(`data-space="${esc(s.id)}"`, "i-space", s.name || "Senza nome", live.filter((n) => n.spaceId === s.id).length || "", f.type === "space" && f.id === s.id)).join("") : `<div class="nav-empty">Nessuno spazio. Crea uno spazio per lavorare insieme ad altri.</div>`;
  }
  return "";
}

function renderSidebar() {
  const hidden = new Set(P().hidden || []);
  let h = "";
  for (const s of SECTIONS) {
    if (hidden.has(s.key) || (s.cloud && !sharedOn())) continue;
    const c = sectionCount(s.key);
    const open = s.kids && isOpen(s.key);
    const addLbl = s.add === "nb" ? "Nuovo taccuino" : "Nuovo spazio";
    h += `<div class="nav-row">${s.kids ? `<button class="caret" type="button" data-toggle="${s.key}" aria-expanded="${open}" aria-label="${open ? "Comprimi" : "Espandi"} ${esc(s.label)}">${ic("i-caret")}</button>` : `<span class="caret-sp"></span>`}<button class="nav-item${sectionActive(s.key) ? " active" : ""}" type="button" data-go="${s.key}" data-sec="${s.key}" title="${esc(s.label)}">${ic(s.icon)}<span class="lbl">${esc(s.label)}</span><span class="n">${c || ""}</span></button>${s.add && !S.readOnly ? `<button class="nav-add" type="button" data-add="${s.add}" aria-label="${addLbl}" title="${addLbl}">${ic("i-plus", "ic sm")}</button>` : ""}</div>`;
    if (open) h += `<div class="nav-kids">${kidsHtml(s.key)}</div>`;
  }
  if (hidden.size && P().showMore !== false) h += `<div class="nav-row"><span class="caret-sp"></span><button class="nav-item" type="button" id="btnMoreNav" title="Altro" aria-haspopup="menu">${ic("i-more")}<span class="lbl">Altro</span></button></div>`;
  $("#nav").innerHTML = h;
  const tags = [...allTags().keys()].sort((a, b) => a.localeCompare(b, "it"));
  $("#tagSuggest").innerHTML = tags.map((t) => `<option value="${esc(t)}"></option>`).join("");
  $("#btnNew").disabled = S.readOnly; $("#btnNew2").disabled = S.readOnly;
  renderAcct();
}

function renderAcct() {
  const name = S.myName || "Quaderno";
  $("#acctName").textContent = name;
  $("#acctAv").textContent = (name.trim()[0] || "Q").toUpperCase();
  const rail = app.classList.contains("rail");
  const b = $("#btnCollapse");
  b.innerHTML = ic(rail ? "i-expand" : "i-collapse");
  b.title = rail ? "Espandi il menu" : "Comprimi il menu";
  b.setAttribute("aria-label", b.title);
}

/* ---------- note list ---------- */
function listTitle() {
  const f = S.filter;
  return ({ starred: "Scorciatoie", reminders: "Promemoria", trash: "Cestino", templates: "Modelli", shared: "Condivisi con me" })[f.type]
    || (f.type === "notebook" ? nbName(f.id) || "Taccuino" : f.type === "space" ? nbName(f.id) || "Spazio" : f.type === "tag" ? "#" + f.tag : "Note");
}

function renderList() {
  if (!S.ready || app.classList.contains("paged")) return;
  const arr = visibleNotes();
  $("#listTitle").textContent = listTitle();
  $("#listCount").textContent = (arr.length === 1 ? "1 " : arr.length + " ") + (S.filter.type === "templates" ? (arr.length === 1 ? "modello" : "modelli") : arr.length === 1 ? "nota" : "note");
  const f = S.filter, acts = $("#listActions");
  if (S.readOnly) acts.innerHTML = "";
  else if (f.type === "notebook") acts.innerHTML = `<button class="text-btn" type="button" data-act="nb-menu" aria-haspopup="menu">Azioni ⋯</button>`;
  else if (f.type === "space") acts.innerHTML = `<button class="text-btn" type="button" data-act="space-menu" aria-haspopup="menu">Azioni ⋯</button>`;
  else if (f.type === "templates") acts.innerHTML = `<button class="text-btn" type="button" data-act="from-tpl">Usa un modello</button>`;
  else if (f.type === "trash" && arr.length) acts.innerHTML = `<button class="text-btn danger" type="button" data-act="empty-trash">Svuota cestino</button>`;
  else acts.innerHTML = "";

  if (!arr.length) {
    const total = liveNotes().length;
    let html;
    const newBtn = (label = "Nuova nota") => S.readOnly ? "" : `<span class="row"><button class="btn primary" type="button" data-act="new">${label}</button></span>`;
    if (S.query) html = `<strong>Nessun risultato</strong><span>Nessuna nota corrisponde a “${esc(S.query)}”.</span><span>Puoi cercare anche con <code>tag:casa</code>, <code>-tag:casa</code>, <code>taccuino:lavoro</code>, <code>titolo:spesa</code>, <code>todo:false</code>, <code>promemoria:*</code>, <code>"frase esatta"</code> e <code>-parola</code>.</span>`;
    else if (f.type === "reminders") html = `<strong>Nessun promemoria</strong><span>Apri una nota e tocca la campanella in alto per farti ricordare qualcosa a un giorno e un'ora precisi.</span>`;
    else if (f.type === "trash") html = `<strong>Il cestino è vuoto</strong><span>Le note eliminate restano qui finché non svuoti il cestino.</span>`;
    else if (f.type === "starred") html = `<strong>Nessuna scorciatoia</strong><span>Tocca la stella in una nota per ritrovarla qui. Per taccuini e tag usa il tasto destro nel menu.</span>`;
    else if (f.type === "templates") html = `<strong>Nessun modello tuo</strong><span>Crea un modello qui, oppure apri una nota e scegli ⋯ › Salva come modello.</span>${S.readOnly ? "" : `<span class="row"><button class="btn primary" type="button" data-act="new">Nuovo modello</button><button class="btn" type="button" data-act="from-tpl">Modelli pronti</button></span>`}`;
    else if (f.type === "shared") html = `<strong>Niente di condiviso con te</strong><span>Qui compaiono le note che altre persone scrivono negli spazi condivisi.</span>`;
    else if (f.type === "space") html = `<strong>Spazio vuoto</strong><span>Le note di questo spazio sono visibili a tutte le persone con cui condividi Quaderno.</span>${newBtn()}`;
    else if (!total && !S.readOnly) html = `<strong>Il tuo quaderno è vuoto</strong><span>Scrivi la prima nota, importa da Evernote o carica qualche nota di esempio.</span><span class="row"><button class="btn primary" type="button" data-act="new">Nuova nota</button><button class="btn" type="button" data-act="import">Importa da Evernote</button><button class="btn" type="button" data-act="samples">Note di esempio</button></span>`;
    else html = `<strong>Nessuna nota qui</strong>${newBtn()}`;
    noteList.innerHTML = `<div class="list-empty">${html}</div>`;
    return;
  }
  const authors = [];
  noteList.innerHTML = arr.map((n) => {
    const p = parsed(n.id, n.html);
    const meta = [`<span>${esc(relDate(S.sort === "created" ? n.createdAt : n.updatedAt))}</span>`];
    if (f.type !== "notebook" && f.type !== "space" && containerName(n)) meta.push(`<span>· ${esc(containerName(n))}</span>`);
    if (n._shared && n.createdBy) { authors.push(n.createdBy); meta.push(`<span>· di ${esc(personName(n.createdBy))}</span>`); }
    if (n.isTemplate && f.type !== "templates") meta.push(`<span class="badge">Modello</span>`);
    if (n.reminder && !n.reminderDone) meta.push(`<span title="Promemoria"${n.reminder < Date.now() ? ' style="color:var(--danger)"' : ""}>🔔 ${esc(remLabel(n.reminder))}</span>`);
    if (p.atts.length) meta.push(`<span title="Allegati">📎 ${p.atts.length}</span>`);
    (n.tags || []).slice(0, 3).forEach((t) => meta.push(`<span class="chip">${esc(t)}</span>`));
    const thumb = imgTag(p.img && p.img.src, "thumb");
    return `<button class="card${n.id === S.activeId ? " active" : ""}" type="button" data-id="${esc(n.id)}">
      <span class="card-main">
        <span class="card-title">${n.pinned ? ic("i-star") : ""}<span>${esc(n.title || "Senza titolo")}</span></span>
        <span class="card-snip">${esc(p.text.slice(0, 220)) || "<em>Nessun contenuto</em>"}</span>
        <span class="card-meta">${meta.join("")}</span>
      </span>${thumb}</button>`;
  }).join("");
  if (authors.length) resolveNames(authors);
  hydrate(noteList, true);
}

function renderAll(fromRemote) {
  renderSidebar();
  if (app.classList.contains("paged")) renderPage();
  else {
    renderList();
    if (fromRemote) syncEditorFromRemote(); else renderEditorMeta();
  }
  updateSync();
}

/* ---------- views ---------- */
function setView(v) { app.dataset.view = v; }
function openDrawer() { app.classList.add("drawer"); }
function closeDrawer() { app.classList.remove("drawer"); }

function showView() {
  const paged = PAGE_TYPES.has(S.filter.type);
  app.classList.toggle("paged", paged);
  pagePane.hidden = !paged;
  if (paged) S.pageStale = true;
  renderAll();
}

function setFilter(f) {
  flushEditor();
  S.filter = f;
  closeDrawer(); closeMenu();
  if (S.query && !LIST_TYPES.has(f.type)) { S.query = ""; $("#search").value = ""; }
  showView();
  if (PAGE_TYPES.has(f.type)) { renderPage(true); pagePane.scrollTop = 0; return; }
  if (!isNarrow()) {
    const vis = visibleNotes();
    if (!vis.some((n) => n.id === S.activeId)) openNote(vis[0] ? vis[0].id : null);
  } else setView("list");
  noteList.scrollTop = 0;
}

function goNote(id) {
  const n = S.items.get(id);
  if (!n || n.kind !== "note") { toast("Questa nota non esiste più."); return; }
  flushEditor();
  const f = S.filter;
  const fits = LIST_TYPES.has(f.type) && (f.type === "trash" ? n.trashed : !n.trashed) && (f.type === "templates" ? n.isTemplate : !n.isTemplate || f.type === "trash");
  if (!fits) S.filter = n.trashed ? { type: "trash" } : n.isTemplate ? { type: "templates" } : { type: "all" };
  S.query = ""; $("#search").value = "";
  closeDrawer(); closeMenu();
  showView();
  openNote(id);
}

/* ---------- editor ---------- */
const ed = { id: null, stamp: 0, dirty: false, timer: null };

function openNote(id) {
  if (ed.id && ed.id !== id) { flushEditor(); discardIfEmpty(ed.id); }
  S.activeId = id; ed.id = id;
  loadEditor();
  renderList(); renderSidebar();
  setView(id ? "editor" : "list");
  if (id) lsSet("quaderno.last", id);
}

function discardIfEmpty(id) {
  const n = S.items.get(id);
  if (!n || n.kind !== "note" || n.trashed || n.isTemplate) return;
  const p = parsed(id, n.html);
  if (!(n.title || "").trim() && !p.text && !p.atts.length && !(n.tags || []).length && !tasks().some((t) => t.noteId === id) && !events().some((e) => e.noteId === id)) Store.remove(id);
}

function loadEditor() {
  const n = ed.id && S.items.get(ed.id);
  $("#edEmpty").hidden = !!n; $("#edWrap").hidden = !n;
  if (!n) { ed.id = null; S.activeId = null; return; }
  edTitle.value = n.title || "";
  edBody.innerHTML = n.html || "";
  hydrate(edBody, false);
  ed.stamp = n.updatedAt || 0; ed.dirty = false;
  $("#edScroll").scrollTop = 0;
  renderEditorMeta();
}

function renderEditorMeta() {
  const n = ed.id && S.items.get(ed.id);
  if (!n) { $("#edEmpty").hidden = false; $("#edWrap").hidden = true; return; }
  const locked = S.readOnly || !!n.trashed;
  const sel = $("#edNotebook");
  const nbOpts = notebooks().map((nb) => `<option value="nb:${esc(nb.id)}">${esc(nb.name || "Senza nome")}</option>`).join("");
  const spOpts = sharedOn() ? spaces().map((s) => `<option value="sp:${esc(s.id)}">${esc(s.name || "Senza nome")}</option>`).join("") : "";
  sel.innerHTML = (spOpts ? `<optgroup label="Taccuini">${nbOpts}</optgroup><optgroup label="Spazi condivisi">${spOpts}</optgroup>` : nbOpts) + (hasContainer(n) ? "" : `<option value="">Nessun taccuino</option>`);
  sel.value = hasContainer(n) ? (n.spaceId ? "sp:" + n.spaceId : "nb:" + n.notebookId) : "";
  sel.disabled = locked;
  const star = $("#btnStar");
  star.classList.toggle("is-on", !!n.pinned);
  star.setAttribute("aria-pressed", n.pinned ? "true" : "false");
  star.title = n.pinned ? "Togli dalle scorciatoie" : "Aggiungi alle scorciatoie";
  star.setAttribute("aria-label", star.title);
  star.disabled = locked;
  $("#btnTrash").hidden = !!n.trashed; $("#btnTrash").disabled = S.readOnly;
  $("#trashBanner").hidden = !n.trashed;
  $("#btnRestore").disabled = S.readOnly; $("#btnPurge").disabled = S.readOnly;
  edTitle.readOnly = locked;
  edBody.contentEditable = locked ? "false" : "true";
  $("#toolbar").setAttribute("aria-disabled", locked ? "true" : "false");
  $("#tagInput").hidden = locked;
  $("#tagChips").innerHTML = (n.tags || []).map((t, i) => `<span class="tag-chip">${esc(t)}${locked ? "" : `<button type="button" data-rmtag="${i}" aria-label="Rimuovi tag ${esc(t)}">×</button>`}</span>`).join("");
  const lt = tasks().filter((t) => t.noteId === ed.id).sort(byDue), le = events().filter((e) => e.noteId === ed.id).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const bell = $("#btnBell"), hasRem = !!(n.reminder && !n.reminderDone);
  bell.classList.toggle("is-on", hasRem); bell.disabled = locked;
  bell.title = hasRem ? "Promemoria: " + fWhen.format(new Date(n.reminder)) : "Imposta un promemoria";
  bell.setAttribute("aria-label", bell.title);
  const remChip = n.reminder ? `<span class="lk rem${hasRem && n.reminder < Date.now() ? " late" : ""}${n.reminderDone ? " done" : ""}">${ic("i-bell", "ic sm")}<button class="t" type="button" data-rem="${esc(ed.id)}" title="Modifica promemoria">${esc(remLabel(n.reminder))}</button>${locked ? "" : `<button class="x" type="button" data-rem-done="${esc(ed.id)}">${n.reminderDone ? "Riattiva" : "Fatto"}</button>`}</span>` : "";
  const refs = liveNotes().filter((x) => x.id !== ed.id && parsed(x.id, x.html).links.includes(ed.id)).sort(byUpdated);
  $("#edBack").innerHTML = refs.length ? `<span>${ic("i-notelink", "ic sm")} Collegata da:</span>` + refs.map((x) => `<span class="lk"><button class="t" type="button" data-note="${esc(x.id)}">${esc(x.title || "Senza titolo")}</button></span>`).join("") : "";
  $("#edLinks").innerHTML = remChip + lt.map((t) => `<span class="lk${t.done ? " done" : ""}"><button class="chk${t.done ? " on" : ""}" type="button" data-task-toggle="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${t.done ? "Segna da fare" : "Segna come fatta"}: ${esc(t.title)}"${S.readOnly ? " disabled" : ""}></button><button class="t" type="button" data-task-edit="${esc(t.id)}" title="Modifica attività">${esc(t.title || "Attività")}</button>${t.due ? `<span class="due${dueClass(t.due, t.done)}">${esc(dueLabel(t.due))}</span>` : ""}</span>`).join("")
    + le.map((e) => `<span class="lk">${ic("i-cal", "ic sm")}<button class="t" type="button" data-ev="${esc(e.id)}" title="Modifica evento">${esc(dueLabel(e.date))}${e.time ? " " + esc(e.time) : ""} · ${esc(e.title || "Evento")}</button></span>`).join("");
  updateFoot(n);
}

function updateFoot(n) {
  const text = (edBody.innerText || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  const bits = [`<span>${words} ${words === 1 ? "parola" : "parole"}</span>`, `<span>Creata ${esc(relDate(n.createdAt))}</span>`, `<span>Modificata ${esc(relDate(n.updatedAt))}</span>`];
  if (n._shared && n.createdBy) bits.push(`<span>Scritta da ${esc(personName(n.createdBy))}</span>`);
  if (n.isTemplate) bits.push(`<span class="badge">Modello</span>`);
  $("#edFoot").innerHTML = bits.join("");
}

function syncEditorFromRemote() {
  const n = ed.id && S.items.get(ed.id);
  if (!n) { if (ed.id) { ed.id = null; S.activeId = null; loadEditor(); } return; }
  const focused = edBody.contains(document.activeElement) || document.activeElement === edTitle;
  if (!ed.dirty && !focused && (n.updatedAt || 0) > ed.stamp) loadEditor();
  else renderEditorMeta();
}

function scheduleSave() {
  if (!ed.id || S.readOnly) return;
  ed.dirty = true; updateSync();
  clearTimeout(ed.timer);
  ed.timer = setTimeout(flushEditor, 650);
}

function cleanBodyHtml() {
  // blob: addresses of OneDrive images are only for this page: never store them in the note.
  let h = edBody.innerHTML;
  if (h.includes("data-od")) { const c = edBody.cloneNode(true); c.querySelectorAll("img[data-od]").forEach((i) => i.removeAttribute("src")); h = c.innerHTML; }
  return /^(\s|<br\s*\/?>|<p>(\s|<br\s*\/?>)*<\/p>)*$/i.test(h) ? "" : h;
}

function flushEditor() {
  clearTimeout(ed.timer);
  if (!ed.dirty || !ed.id) return;
  const n = S.items.get(ed.id);
  ed.dirty = false;
  if (!n) return;
  const next = { ...n, tags: [...(n.tags || [])], title: edTitle.value.trim(), html: cleanBodyHtml(), updatedAt: Date.now() };
  if (next.spaceId) next.updatedBy = S.me;
  if (JSON.stringify(next).length > MAX_DOC) { toast("Questa nota è troppo lunga per essere salvata. Dividila in più note."); ed.dirty = true; updateSync(); return; }
  ed.stamp = next.updatedAt;
  Store.put(ed.id, next);
  renderList(); renderSidebar(); updateFoot(next); updateSync();
}

function patchNote(id, patch, touch) {
  if (id === ed.id) flushEditor();
  const n = S.items.get(id);
  if (!n) return;
  const next = { ...n, tags: [...(n.tags || [])], ...patch };
  if (touch) next.updatedAt = Date.now();
  if (id === ed.id && touch) ed.stamp = next.updatedAt;
  Store.put(id, next);
  renderAll();
}

function moveNote(id, val) {
  if (!val) return;
  if (id === ed.id) flushEditor();
  const cur = S.items.get(id);
  if (!cur) return;
  const next = { ...cur, tags: [...(cur.tags || [])] };
  if (val.startsWith("sp:")) { next.spaceId = val.slice(3); delete next.notebookId; if (!next.createdBy) next.createdBy = S.me; }
  else { next.notebookId = val.slice(3); delete next.spaceId; }
  Store.put(id, next);
  renderAll();
  toast("Nota spostata in “" + containerName(next) + "”");
}

function newNote(extra = {}) {
  if (S.readOnly) return null;
  flushEditor();
  if (!LIST_TYPES.has(S.filter.type) || S.filter.type === "trash" || S.filter.type === "shared") S.filter = { type: "all" };
  const f = S.filter, now = Date.now(), id = newId("n");
  const data = { kind: "note", title: "", html: "", ...containerForNew(), tags: f.type === "tag" ? [f.tag] : [], pinned: f.type === "starred", trashed: false, isTemplate: f.type === "templates", createdAt: now, updatedAt: now, ...extra };
  if (data.isTemplate && f.type !== "templates") S.filter = { type: "templates" };
  if (!data.isTemplate && f.type === "templates") S.filter = { type: "all" };
  Store.put(id, data);
  S.query = ""; $("#search").value = "";
  closeDrawer();
  showView();
  openNote(id);
  if (!data.title) edTitle.focus(); else { edBody.focus(); restoreRange(null); }
  return id;
}

function duplicateNote() {
  const n = S.items.get(ed.id);
  if (!n || S.readOnly) return;
  flushEditor();
  const src = S.items.get(ed.id), now = Date.now(), id = newId("n");
  const copy = { ...src, title: (src.title || "Senza titolo") + " (copia)", tags: [...(src.tags || [])], pinned: false, reminder: null, reminderDone: false, createdAt: now, updatedAt: now };
  if (copy.spaceId) copy.createdBy = S.me;
  Store.put(id, copy);
  showView(); openNote(id);
  toast("Nota duplicata");
}

/* ---------- templates ---------- */
const BUILTIN_TPL = [
  { title: "Verbale di riunione", html: "<h2>Partecipanti</h2><ul><li><br></li></ul><h2>Ordine del giorno</h2><ol><li><br></li></ol><h2>Decisioni</h2><p><br></p><h2>Prossimi passi</h2><ul data-type=\"checklist\"><li data-checked=\"false\"><br></li></ul>", noteTitle: () => "Riunione del " + fFull.format(new Date()) },
  { title: "Diario", html: "<h2>Come mi sento</h2><p><br></p><h2>Cosa è successo oggi</h2><p><br></p><h2>Per cosa sono grato</h2><ul><li><br></li></ul>", noteTitle: () => cap(fLong.format(new Date())) },
  { title: "Lista di cose da fare", html: "<ul data-type=\"checklist\"><li data-checked=\"false\"><br></li></ul>", noteTitle: () => "Da fare" },
  { title: "Piano di progetto", html: "<h2>Obiettivo</h2><p><br></p><h2>Tappe</h2><ol><li><br></li></ol><h2>Rischi</h2><ul><li><br></li></ul><h2>Risorse</h2><p><br></p>", noteTitle: () => "" },
  { title: "Ricetta", html: "<h2>Ingredienti</h2><ul data-type=\"checklist\"><li data-checked=\"false\"><br></li></ul><h2>Preparazione</h2><ol><li><br></li></ol><h2>Note</h2><p><br></p>", noteTitle: () => "" },
  { title: "Resoconto settimanale", html: "<h2>Fatto questa settimana</h2><ul><li><br></li></ul><h2>Ostacoli</h2><ul><li><br></li></ul><h2>Piano per la prossima</h2><ul data-type=\"checklist\"><li data-checked=\"false\"><br></li></ul>", noteTitle: () => "Settimana del " + fFull.format(new Date()) },
];
async function newFromTemplate(preset) {
  if (S.readOnly) return;
  const mine = notes().filter((n) => n.isTemplate && !n.trashed).sort((a, b) => (a.title || "").localeCompare(b.title || "", "it"));
  let v = preset;
  if (!v) {
    const r = await dialog({
      title: "Nuova nota da modello",
      fields: [{ name: "tpl", label: "Modello", type: "select", value: mine[0] ? "u:" + mine[0].id : "b:0",
        options: [...(mine.length ? [{ group: "I miei modelli", options: mine.map((n) => ({ value: "u:" + n.id, label: n.title || "Senza titolo" })) }] : []),
          { group: "Modelli pronti", options: BUILTIN_TPL.map((t, i) => ({ value: "b:" + i, label: t.title })) }] }],
      ok: "Crea nota",
    });
    if (!r) return;
    v = r.values.tpl;
  }
  let title = "", html = "", tags = [];
  if (v.startsWith("u:")) { const t = S.items.get(v.slice(2)); if (!t) return; title = t.title || ""; html = t.html || ""; tags = [...(t.tags || [])]; }
  else { const t = BUILTIN_TPL[+v.slice(2)]; if (!t) return; title = t.noteTitle(); html = t.html; }
  if (S.filter.type === "templates") S.filter = { type: "all" };
  newNote({ title, html, ...(tags.length ? { tags } : {}), isTemplate: false });
}

/* ---------- tasks & events ---------- */
const byDue = (a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : (a.createdAt || 0) - (b.createdAt || 0));
function noteOptions() {
  return [{ value: "", label: "Nessuna" }, ...liveNotes().sort((a, b) => (a.title || "").localeCompare(b.title || "", "it")).slice(0, 400).map((n) => ({ value: n.id, label: (n.title || "Senza titolo").slice(0, 70) }))];
}
function addTask({ title, due = "", noteId = "" }) {
  if (S.readOnly || !title) return;
  const now = Date.now();
  Store.put(newId("t"), { kind: "task", title: title.slice(0, 300), due, noteId, done: false, createdAt: now, updatedAt: now });
  renderAll();
}
function toggleTask(id) {
  const t = S.items.get(id);
  if (!t || S.readOnly) return;
  Store.put(id, { ...t, done: !t.done, doneAt: t.done ? null : Date.now(), updatedAt: Date.now() });
  renderAll(true);
}
async function newTaskDialog(noteId = "", due = "") {
  if (S.readOnly) return;
  const r = await dialog({ title: "Nuova attività", fields: [{ name: "title", label: "Cosa devi fare?", value: "" }, { name: "due", label: "Scadenza", type: "date", value: due }, { name: "noteId", label: "Nota collegata", type: "select", value: noteId, options: noteOptions() }], ok: "Aggiungi" });
  if (!r) return;
  const title = r.values.title.trim();
  if (!title) { toast("Scrivi il titolo dell'attività."); return; }
  addTask({ title, due: r.values.due, noteId: r.values.noteId });
  toast("Attività aggiunta");
}
async function editTask(id) {
  const t = S.items.get(id);
  if (!t) return;
  if (S.readOnly) { toast("Sola lettura: non puoi modificare le attività."); return; }
  const r = await dialog({ title: "Attività", fields: [{ name: "title", label: "Titolo", value: t.title }, { name: "due", label: "Scadenza", type: "date", value: t.due || "" }, { name: "noteId", label: "Nota collegata", type: "select", value: S.items.get(t.noteId) ? t.noteId : "", options: noteOptions() }, { name: "done", label: "Completata", type: "checkbox", value: !!t.done }], ok: "Salva", extra: [{ label: "Elimina", value: "del", danger: true }] });
  if (!r) return;
  if (r.action === "del") { Store.remove(id); renderAll(true); toast("Attività eliminata"); return; }
  const v = r.values;
  Store.put(id, { ...t, title: v.title.trim() || t.title, due: v.due, noteId: v.noteId, done: v.done, doneAt: v.done ? t.doneAt || Date.now() : null, updatedAt: Date.now() });
  renderAll(true);
}
function addEvent({ title, date, time = "", noteId = "" }) {
  if (S.readOnly || !title || !date) return;
  const now = Date.now();
  Store.put(newId("e"), { kind: "event", title: title.slice(0, 300), date, time, noteId, createdAt: now, updatedAt: now });
  renderAll(true);
}
async function newEvent(date = todayStr(), noteId = "") {
  if (S.readOnly) return;
  const r = await dialog({ title: "Nuovo evento", fields: [{ name: "title", label: "Titolo", value: "" }, { name: "date", label: "Giorno", type: "date", value: date }, { name: "time", label: "Ora (facoltativa)", type: "time", value: "" }, { name: "noteId", label: "Nota collegata", type: "select", value: noteId, options: noteOptions() }], ok: "Aggiungi" });
  if (!r) return;
  const v = r.values;
  if (!v.title.trim() || !v.date) { toast("Servono titolo e giorno."); return; }
  addEvent({ title: v.title.trim(), date: v.date, time: v.time, noteId: v.noteId });
  toast("Evento aggiunto al calendario");
}
async function editEvent(id) {
  const e = S.items.get(id);
  if (!e) return;
  if (S.readOnly) { toast("Sola lettura: non puoi modificare gli eventi."); return; }
  const linked = e.noteId && S.items.get(e.noteId);
  const r = await dialog({ title: "Evento", fields: [{ name: "title", label: "Titolo", value: e.title }, { name: "date", label: "Giorno", type: "date", value: e.date }, { name: "time", label: "Ora (facoltativa)", type: "time", value: e.time || "" }, { name: "noteId", label: "Nota collegata", type: "select", value: linked ? e.noteId : "", options: noteOptions() }], ok: "Salva", extra: [{ label: "Elimina", value: "del", danger: true }, ...(linked ? [{ label: "Apri nota", value: "open" }] : [])] });
  if (!r) return;
  if (r.action === "del") { Store.remove(id); renderAll(true); toast("Evento eliminato"); return; }
  if (r.action === "open") { goNote(e.noteId); return; }
  const v = r.values;
  Store.put(id, { ...e, title: v.title.trim() || e.title, date: v.date || e.date, time: v.time, noteId: v.noteId, updatedAt: Date.now() });
  renderAll(true);
}
function agenda(from, days) {
  const to = addDays(from, days), out = [];
  events().forEach((e) => { if (e.date >= from && e.date < to) out.push({ k: "ev", id: e.id, date: e.date, time: e.time || "", title: e.title }); });
  tasks().forEach((t) => { if (t.due && !t.done && t.due >= from && t.due < to) out.push({ k: "task", id: t.id, date: t.due, time: "", title: t.title }); });
  activeReminders().forEach((n) => { const d = new Date(n.reminder), k = ymd(d); if (k >= from && k < to) out.push({ k: "rem", id: n.id, date: k, time: hm(d), title: n.title || "Senza titolo" }); });
  return out.sort((a, b) => (a.date + (a.time || "~")).localeCompare(b.date + (b.time || "~")));
}
function noteChecklists() {
  const out = [];
  for (const n of liveNotes().sort(byUpdated)) {
    if (!/data-type="checklist"/.test(n.html || "")) continue;
    const t = document.createElement("template"); t.innerHTML = n.html;
    const items = $$('ul[data-type="checklist"] > li', t.content).map((li, i) => ({ i, text: li.textContent.trim(), done: li.dataset.checked === "true" })).filter((x) => x.text);
    if (items.length) out.push({ id: n.id, title: n.title || "Senza titolo", items });
    if (out.length >= 40) break;
  }
  return out;
}
function toggleChecklistItem(id, idx) {
  if (S.readOnly) return;
  if (id === ed.id) flushEditor();
  const n = S.items.get(id);
  if (!n) return;
  const t = document.createElement("template"); t.innerHTML = n.html || "";
  const li = $$('ul[data-type="checklist"] > li', t.content)[idx];
  if (!li) return;
  li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
  patchNote(id, { html: t.innerHTML }, true);
  if (id === ed.id) loadEditor();
}

/* ---------- reminders ---------- */
async function setReminder(id) {
  const n = S.items.get(id);
  if (!n || S.readOnly || n.trashed) return;
  const d = n.reminder ? new Date(n.reminder) : new Date(Date.now() + 3600000);
  if (!n.reminder) d.setMinutes(0, 0, 0);
  const r = await dialog({
    title: "Promemoria", text: "Quando vuoi che Quaderno ti ricordi questa nota? L'avviso compare qui nell'app, e la nota resta nella sezione Promemoria finché non la segni come fatta.",
    fields: [{ name: "d", label: "Giorno", type: "date", value: ymd(d) }, { name: "t", label: "Ora", type: "time", value: hm(d) }],
    ok: "Imposta", extra: n.reminder ? [{ label: "Rimuovi", value: "del", danger: true }] : [],
  });
  if (!r) return;
  if (r.action === "del") { patchNote(id, { reminder: null, reminderDone: false }, false); toast("Promemoria rimosso"); return; }
  const [y, m, dd] = (r.values.d || "").split("-").map(Number), [hh, mm] = (r.values.t || "09:00").split(":").map(Number);
  const ts = y ? new Date(y, m - 1, dd, hh || 0, mm || 0).getTime() : 0;
  if (!ts) { toast("Scegli un giorno per il promemoria."); return; }
  notified.delete(id);
  patchNote(id, { reminder: ts, reminderDone: false }, false);
  toast("Promemoria impostato: " + fWhen.format(new Date(ts)));
  if ("Notification" in window && Notification.permission === "default") setTimeout(askNotify, 1200);
}
function toggleReminderDone(id) {
  const n = S.items.get(id);
  if (!n || S.readOnly) return;
  patchNote(id, { reminderDone: !n.reminderDone }, false);
  toast(n.reminderDone ? "Promemoria riattivato" : "Promemoria segnato come fatto");
}
const notified = new Set();
function checkReminders() {
  if (!S.ready) return;
  const due = activeReminders().filter((n) => n.reminder <= Date.now() && !notified.has(n.id));
  due.forEach((n) => notified.add(n.id));
  if (!due.length) return;
  toast("🔔 Promemoria: " + due.map((n) => n.title || "Senza titolo").join(", "));
  due.filter((n) => Date.now() - n.reminder < 6 * 3600000).forEach((n) => notify("🔔 " + (n.title || "Promemoria"), "Promemoria di Quaderno · " + remLabel(n.reminder), n.id));
  renderSidebar();
  if (ed.id && due.some((n) => n.id === ed.id)) renderEditorMeta();
}

/* ---------- notebooks, stacks, tags, spaces ---------- */
async function addNotebook() {
  if (S.readOnly) return;
  const name = await ask({ title: "Nuovo taccuino", input: "", ok: "Crea" });
  if (!name) return;
  const id = newId("b");
  Store.put(id, { kind: "notebook", name: name.slice(0, 80), createdAt: Date.now() });
  setFilter({ type: "notebook", id });
}
async function renameNotebook(id) {
  const nb = S.items.get(id);
  if (!nb) return;
  const name = await ask({ title: nb.kind === "space" ? "Rinomina spazio" : "Rinomina taccuino", input: nb.name || "", ok: "Rinomina" });
  if (name) { Store.put(id, { ...nb, name: name.slice(0, 80) }); renderAll(); }
}
async function setStack(id) {
  const nb = S.items.get(id);
  if (!nb) return;
  const stacks = [...new Set(notebooks().map((n) => n.stack).filter(Boolean))];
  const name = await ask({ title: "Pila del taccuino", text: "Le pile raggruppano più taccuini sotto lo stesso nome." + (stacks.length ? " Pile esistenti: " + stacks.join(", ") + "." : "") + " Lascia vuoto per togliere il taccuino dalla pila.", input: nb.stack || "", ok: "Salva" });
  if (name === null) return;
  Store.put(id, { ...nb, stack: name.slice(0, 60) });
  renderAll();
}
async function renameStack(st) {
  const name = await ask({ title: "Rinomina pila", input: st, ok: "Rinomina" });
  if (!name || name === st) return;
  notebooks().filter((n) => n.stack === st).forEach((n) => Store.put(n.id, { ...S.items.get(n.id), stack: name.slice(0, 60) }));
  renderAll();
}
function dissolveStack(st) {
  notebooks().filter((n) => n.stack === st).forEach((n) => Store.put(n.id, { ...S.items.get(n.id), stack: "" }));
  renderAll(); toast("Pila sciolta: i taccuini restano");
}
function dropShortcut(t, id) { const cur = P().shortcuts || []; if (cur.some((s) => s.t === t && s.id === id)) setPrefs({ shortcuts: cur.filter((s) => !(s.t === t && s.id === id)) }); }
async function deleteNotebook(id) {
  const nb = S.items.get(id);
  if (!nb) return;
  const isSpace = nb.kind === "space";
  const inNb = notes().filter((n) => (isSpace ? n.spaceId === id : n.notebookId === id && !n.spaceId) && !n.trashed);
  const ok = await ask({ title: `Eliminare “${nb.name || "Senza nome"}”?`, text: (inNb.length ? `${inNb.length === 1 ? "La sua nota andrà" : "Le sue " + inNb.length + " note andranno"} nel cestino, da cui potrai ancora recuperarle.` : (isSpace ? "Lo spazio è vuoto." : "Il taccuino è vuoto.")) + (isSpace ? " Lo spazio sparirà per tutte le persone che lo usano." : ""), ok: isSpace ? "Elimina spazio" : "Elimina taccuino", danger: true });
  if (!ok) return;
  flushEditor();
  inNb.forEach((n) => Store.put(n.id, { ...S.items.get(n.id), trashed: true, trashedAt: Date.now() }));
  Store.remove(id);
  dropShortcut(isSpace ? "space" : "notebook", id);
  if ((S.filter.type === "notebook" || S.filter.type === "space") && S.filter.id === id) setFilter({ type: "all" }); else renderAll();
  toast(isSpace ? "Spazio eliminato" : "Taccuino eliminato");
}
async function addSpace() {
  if (S.readOnly || !sharedOn()) return;
  const name = await ask({ title: "Nuovo spazio", text: "Uno spazio è un taccuino condiviso: le sue note sono visibili a tutte le persone con cui condividi Quaderno (menu Condividi in alto).", input: "", ok: "Crea spazio" });
  if (!name) return;
  const id = newId("s");
  Store.put(id, { kind: "space", name: name.slice(0, 80), createdBy: S.me, createdAt: Date.now() });
  setFilter({ type: "space", id });
}
async function renameTag(old) {
  const name = await ask({ title: "Rinomina tag", input: old, ok: "Rinomina" });
  const t = name && name.replace(/^#/, "").replace(/,/g, " ").trim().slice(0, 40);
  if (!t || t === old) return;
  flushEditor();
  notes().filter((n) => (n.tags || []).includes(old)).forEach((n) => {
    const cur = S.items.get(n.id);
    Store.put(n.id, { ...cur, tags: [...new Set((cur.tags || []).map((x) => (x === old ? t : x)))] });
  });
  const sc = P().shortcuts || [];
  if (sc.some((s) => s.t === "tag" && s.id === old)) setPrefs({ shortcuts: sc.map((s) => (s.t === "tag" && s.id === old ? { t: "tag", id: t } : s)) });
  if (S.filter.type === "tag" && S.filter.tag === old) S.filter = { type: "tag", tag: t };
  renderAll(); toast("Tag rinominato");
}
async function deleteTag(t) {
  const ns = notes().filter((n) => (n.tags || []).includes(t));
  const ok = await ask({ title: `Eliminare il tag “${t}”?`, text: `Verrà tolto da ${ns.length === 1 ? "1 nota" : ns.length + " note"}. Le note restano.`, ok: "Elimina tag", danger: true });
  if (!ok) return;
  flushEditor();
  ns.forEach((n) => { const cur = S.items.get(n.id); Store.put(n.id, { ...cur, tags: (cur.tags || []).filter((x) => x !== t) }); });
  dropShortcut("tag", t);
  if (S.filter.type === "tag" && S.filter.tag === t) setFilter({ type: "tags" }); else renderAll();
  toast("Tag eliminato");
}

function notebookMenu(id) {
  const nb = S.items.get(id);
  if (!nb) return [];
  const isSpace = nb.kind === "space", t = isSpace ? "space" : "notebook";
  const go = { type: t, id };
  const ro = S.readOnly;
  return [
    { head: nb.name || "Senza nome" },
    { label: "Apri", icon: isSpace ? "i-space" : "i-book", action: () => setFilter(go) },
    { label: "Nuova nota qui", icon: "i-plus", disabled: ro, action: () => { S.filter = go; newNote(); } },
    "-",
    { label: isShortcut(t, id) ? "Togli dalle scorciatoie" : "Aggiungi alle scorciatoie", icon: "i-star", disabled: ro, action: () => toggleShortcut(t, id) },
    !isSpace && { label: nb.stack ? "Cambia pila…" : "Aggiungi a una pila…", icon: "i-stack", disabled: ro, action: () => setStack(id) },
    { label: "Rinomina…", icon: "i-edit", disabled: ro, action: () => renameNotebook(id) },
    "-",
    { label: isSpace ? "Elimina spazio…" : "Elimina taccuino…", icon: "i-trash", danger: true, disabled: ro, action: () => deleteNotebook(id) },
  ];
}
function tagMenu(t) {
  const ro = S.readOnly;
  return [
    { head: "#" + t },
    { label: "Mostra le note", icon: "i-tag", action: () => setFilter({ type: "tag", tag: t }) },
    { label: isShortcut("tag", t) ? "Togli dalle scorciatoie" : "Aggiungi alle scorciatoie", icon: "i-star", disabled: ro, action: () => toggleShortcut("tag", t) },
    { label: "Rinomina…", icon: "i-edit", disabled: ro, action: () => renameTag(t) },
    "-",
    { label: "Elimina tag…", icon: "i-trash", danger: true, disabled: ro, action: () => deleteTag(t) },
  ];
}
function stackMenu(st) {
  const ro = S.readOnly;
  return [{ head: "Pila: " + st }, { label: "Vedi i taccuini", icon: "i-book", action: () => setFilter({ type: "notebooks" }) }, { label: "Rinomina pila…", icon: "i-edit", disabled: ro, action: () => renameStack(st) }, { label: "Sciogli pila", icon: "i-stack", disabled: ro, action: () => dissolveStack(st) }];
}
function sectionMenu(key) {
  return [{ head: SEC[key].label }, { label: "Apri", icon: SEC[key].icon, action: () => setFilter(goFilter(key)) }, { label: "Nascondi dal menu", icon: "i-hide", disabled: S.readOnly, action: () => hideSection(key) }, { label: "Personalizza menu…", icon: "i-gear", disabled: S.readOnly, action: customizeMenu }];
}
function hideSection(key) {
  setPrefs({ hidden: [...new Set([...(P().hidden || []), key])] });
  renderAll();
  toast(`“${SEC[key].label}” nascosto.` + (P().showMore !== false ? " Lo ritrovi in Altro." : " Puoi rimetterlo da Personalizza menu."));
}
async function customizeMenu() {
  if (S.readOnly) return;
  const hidden = new Set(P().hidden || []);
  const fields = SECTIONS.filter((s) => !s.cloud || sharedOn()).map((s) => ({ name: s.key, label: s.label, type: "checkbox", value: !hidden.has(s.key) }));
  fields.push({ name: "_more", label: "Mostra «Altro» con le voci nascoste", type: "checkbox", value: P().showMore !== false });
  const r = await dialog({ title: "Personalizza il menu", text: "Scegli quali voci mostrare nel menu a sinistra. Puoi anche fare clic destro su una voce per nasconderla.", fields, ok: "Salva" });
  if (!r) return;
  setPrefs({ hidden: SECTIONS.filter((s) => r.values[s.key] === false).map((s) => s.key), showMore: !!r.values._more });
  renderAll();
}
function openMoreMenu(anchor) {
  const hidden = (P().hidden || []).filter((k) => SEC[k] && (!SEC[k].cloud || sharedOn()));
  openMenu(anchor, [...hidden.map((k) => ({ label: SEC[k].label, icon: SEC[k].icon, action: () => setFilter(goFilter(k)) })), "-", { label: "Personalizza menu…", icon: "i-gear", disabled: S.readOnly, action: customizeMenu }]);
}
function newMenu(anchor) {
  const ro = S.readOnly;
  openMenu(anchor, [
    { label: "Nota", icon: "i-notes", k: "Alt+N", disabled: ro, action: () => newNote() },
    { label: "Nota da modello…", icon: "i-tpl", disabled: ro, action: () => newFromTemplate() },
    { label: "Attività…", icon: "i-task", disabled: ro, action: () => newTaskDialog() },
    { label: "Evento…", icon: "i-cal", disabled: ro, action: () => newEvent() },
    "-",
    { label: "Taccuino…", icon: "i-book", disabled: ro, action: addNotebook },
    sharedOn() && { label: "Spazio condiviso…", icon: "i-space", disabled: ro, action: addSpace },
    "-",
    { label: "Carica file…", icon: "i-clip", disabled: ro || !Store.assets, action: () => $("#fileNew").click() },
    { label: "Importa da Evernote…", icon: "i-import", disabled: ro, action: startImport },
  ]);
}
function acctMenu(anchor) {
  const rail = app.classList.contains("rail");
  const cloud = Store.mode === "cloud", acc = Cloud.Auth.account || {};
  openMenu(anchor, [
    { head: cloud ? (acc.username || S.myName || "Il tuo account Microsoft") : "Solo su questo dispositivo" },
    cloud && { label: "Sincronizza ora", icon: "i-cloud", k: Store.lastSync ? relDate(Store.lastSync) : "", action: () => { Store.needAuth = false; Store.sync(); } },
    cloud && { label: "Apri la cartella in OneDrive", icon: "i-book", action: openDriveFolder },
    cloud && { label: P().readable === false ? "Attiva le copie leggibili (.html)" : "Disattiva le copie leggibili (.html)", icon: "i-file", action: () => OD.toggle() },
    cloud && P().readable !== false && { label: "Rigenera tutte le copie leggibili", icon: "i-redo", action: () => OD.syncAll() },
    !cloud && { label: "Collega OneDrive…", icon: "i-cloud", action: connectOneDrive },
    "-",
    { label: "Personalizza menu…", icon: "i-gear", disabled: S.readOnly, action: customizeMenu },
    !isDrawer() && { label: rail ? "Espandi il menu" : "Comprimi il menu", icon: rail ? "i-expand" : "i-collapse", action: toggleRail },
    "Notification" in window && Notification.permission === "default" && { label: "Attiva le notifiche dei promemoria", icon: "i-bell", action: askNotify },
    "-",
    { label: "Importa da Evernote…", icon: "i-import", disabled: S.readOnly, action: startImport },
    { label: "Esporta tutte le note (.md)", icon: "i-download", action: exportAll },
    { label: "Backup completo (.json)", icon: "i-save", action: exportBackup },
    { label: "Ripristina da backup…", icon: "i-import", disabled: S.readOnly, action: () => $("#backupInput").click() },
    "-",
    { label: cloud ? "Esci (cancella la copia da questo dispositivo)" : "Cancella le note da questo dispositivo", icon: "i-back", danger: !cloud, action: signOut },
  ]);
}
async function openDriveFolder() {
  try { const r = await Cloud.Drive.info(); if (r && r.webUrl) openUrl(r.webUrl); }
  catch (e) { toast(e && e.code === "offline" ? "Sei offline." : "Non riesco ad aprire OneDrive adesso."); }
}
async function askNotify() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
  if (Notification.permission === "granted") toast("Notifiche attive: i promemoria arriveranno anche con Quaderno in secondo piano.");
  return Notification.permission === "granted";
}
async function notify(title, body, noteId) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, tag: "q-" + noteId, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { noteId } };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, opts);
    else { const n = new Notification(title, opts); n.onclick = () => { window.focus(); goNote(noteId); n.close(); }; }
  } catch (e) {}
}
function toggleRail() {
  if (isDrawer()) { closeDrawer(); return; }
  app.classList.toggle("rail");
  lsSet("quaderno.rail", app.classList.contains("rail") ? "1" : "0");
  renderAcct();
}
function noteMenu(anchor) {
  const n = S.items.get(ed.id);
  if (!n) return;
  const locked = S.readOnly || !!n.trashed;
  openMenu(anchor, [
    { label: n.isTemplate ? "Non usare più come modello" : "Salva come modello", icon: "i-tpl", disabled: locked, action: () => { const was = n.isTemplate; patchNote(ed.id, { isTemplate: !was }, false); toast(was ? "La nota non è più un modello" : "Salvata tra i Modelli"); } },
    { label: "Duplica nota", icon: "i-copy", disabled: locked, action: duplicateNote },
    { label: n.pinned ? "Togli dalle scorciatoie" : "Aggiungi alle scorciatoie", icon: "i-star", disabled: locked, action: () => patchNote(ed.id, { pinned: !n.pinned }, false) },
    "-",
    { label: n.reminder && !n.reminderDone ? "Modifica promemoria…" : "Imposta promemoria…", icon: "i-bell", disabled: locked, action: () => setReminder(ed.id) },
    Store.sample && { label: "Assistente…", icon: "i-spark", disabled: locked, action: () => aiMenu($("#btnNoteMore")) },
    { label: "Aggiungi attività collegata…", icon: "i-task", disabled: locked, action: () => newTaskDialog(ed.id) },
    { label: "Aggiungi evento collegato…", icon: "i-cal", disabled: locked, action: () => newEvent(todayStr(), ed.id) },
    { label: "Allega file…", icon: "i-clip", disabled: locked || !Store.assets, action: () => $("#fileInput").click() },
    "-",
    { label: "Esporta in Markdown", icon: "i-download", action: exportNote },
    { label: "Scarica come pagina .html", icon: "i-download", action: saveToOneDrive },
    OD.on && { label: "Apri la copia leggibile in OneDrive", icon: "i-cloud", action: () => OD.open(ed.id) },
  ], { alignRight: true });
}

/* ---------- search palette ---------- */
const pal = { items: [], sel: 0 };
function openPalette(q = "") {
  closeMenu(); closeDrawer();
  $("#palette").hidden = false;
  const inp = $("#palInput");
  inp.value = q;
  renderPalette();
  setTimeout(() => inp.focus(), 0);
}
function closePalette() { $("#palette").hidden = true; }
function renderPalette() {
  const q = $("#palInput").value.trim(), terms = norm(q).split(/\s+/).filter(Boolean);
  const match = (s) => terms.every((t) => norm(s).includes(t));
  const res = [];
  const add = (h, it) => res.push({ ...it, h: res.some((r) => r.group === h) ? null : h, group: h });
  if (q) add("Cerca", { icon: "i-search", title: `Cerca “${q}” in tutte le note`, sub: "Mostra i risultati nell'elenco delle note", run: () => { flushEditor(); S.filter = { type: "all" }; S.query = q; $("#search").value = q; showView(); const v = visibleNotes(); if (!isNarrow() && v[0]) openNote(v[0].id); else setView("list"); } });
  const pq = parseQuery(q);
  const ns = notes().filter((n) => !n.trashed && matchQuery(n, pq)).sort(byUpdated).slice(0, terms.length ? 25 : 8);
  ns.forEach((n) => add(terms.length ? "Note" : "Note recenti", { icon: n.isTemplate ? "i-tpl" : "i-notes", title: n.title || "Senza titolo", sub: [containerName(n), parsed(n.id, n.html).text.slice(0, 90)].filter(Boolean).join(" · "), run: () => goNote(n.id) }));
  if (terms.length) {
    notebooks().filter((nb) => match(nb.name || "")).slice(0, 5).forEach((nb) => add("Taccuini", { icon: "i-book", title: nb.name, run: () => setFilter({ type: "notebook", id: nb.id }) }));
    spaces().filter((s) => match(s.name || "")).slice(0, 5).forEach((s) => add("Spazi", { icon: "i-space", title: s.name, run: () => setFilter({ type: "space", id: s.id }) }));
    [...allTags().keys()].filter(match).slice(0, 6).forEach((t) => add("Tag", { icon: "i-tag", title: t, run: () => setFilter({ type: "tag", tag: t }) }));
    tasks().filter((t) => match(t.title || "")).slice(0, 6).forEach((t) => add("Attività", { icon: "i-task", title: t.title, sub: t.due ? "Scadenza: " + dueLabel(t.due) : "", run: () => editTask(t.id) }));
    events().filter((e) => match(e.title || "")).slice(0, 6).forEach((e) => add("Eventi", { icon: "i-cal", title: e.title, sub: dueLabel(e.date) + (e.time ? " " + e.time : ""), run: () => editEvent(e.id) }));
  } else {
    SECTIONS.filter((s) => !s.cloud || sharedOn()).forEach((s) => add("Vai a", { icon: s.icon, title: s.label, run: () => setFilter(goFilter(s.key)) }));
  }
  pal.items = res; pal.sel = 0;
  $("#palList").innerHTML = res.length ? res.map((r, i) => (r.h ? `<div class="pal-h">${esc(r.h)}</div>` : "") + `<button type="button" class="pal-item${i === 0 ? " sel" : ""}" role="option" aria-selected="${i === 0}" data-i="${i}">${ic(r.icon)}<span class="tx"><b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span></button>`).join("") : `<div class="empty-s" style="padding:14px">Nessun risultato.</div>`;
}
function palSelect(i) {
  const items = $$(".pal-item", $("#palList"));
  if (!items.length) return;
  pal.sel = (i + items.length) % items.length;
  items.forEach((b, k) => { b.classList.toggle("sel", k === pal.sel); b.setAttribute("aria-selected", k === pal.sel); });
  items[pal.sel].scrollIntoView({ block: "nearest" });
}
function palRun(i) { const it = pal.items[i]; closePalette(); if (it) it.run(); }

/* ---------- pages ---------- */
function pgHead(title, acts = "", eyebrow = "") {
  return `<div class="pg-head"><button class="icon-btn menu-btn" type="button" data-pg="menu" aria-label="Apri il menu">${ic("i-menu")}</button><div class="ttl">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h1>${esc(title)}</h1></div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`;
}
function miniCard(n) {
  const p = parsed(n.id, n.html);
  return `<button class="mini" type="button" data-note="${esc(n.id)}"><b>${esc(n.title || "Senza titolo")}</b><span>${esc(p.text.slice(0, 160)) || "Nessun contenuto"}</span><small>${esc(relDate(n.updatedAt))}${containerName(n) ? " · " + esc(containerName(n)) : ""}</small></button>`;
}
function taskRow(t) {
  const n = t.noteId && S.items.get(t.noteId);
  return `<div class="row-i${t.done ? " done" : ""}"><button class="chk${t.done ? " on" : ""}" type="button" data-task-toggle="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${t.done ? "Segna da fare" : "Segna come fatta"}: ${esc(t.title)}"${S.readOnly ? " disabled" : ""}></button><button class="grow" type="button" data-task-edit="${esc(t.id)}" title="Modifica">${esc(t.title || "Senza titolo")}</button>${n && n.kind === "note" ? `<button class="link-btn" type="button" data-note="${esc(t.noteId)}" title="Apri “${esc(n.title || "Senza titolo")}”">${ic("i-notes", "ic sm")}</button>` : ""}${t.due ? `<span class="due${dueClass(t.due, t.done)}">${esc(dueLabel(t.due))}</span>` : ""}</div>`;
}
function agendaRow(x) {
  return `<div class="row-i"><span class="due${x.date === todayStr() ? " today" : ""}">${esc(dueLabel(x.date))}${x.time ? " " + esc(x.time) : ""}</span>${ic(x.k === "ev" ? "i-cal" : x.k === "rem" ? "i-bell" : "i-task", "ic sm")}<button class="grow" type="button" ${x.k === "ev" ? `data-ev="${esc(x.id)}"` : x.k === "rem" ? `data-note="${esc(x.id)}"` : `data-task-edit="${esc(x.id)}"`}>${esc(x.title || "Senza titolo")}</button></div>`;
}

function pageHome() {
  const hr = new Date().getHours();
  const greet = (hr < 13 ? "Buongiorno" : hr < 18 ? "Buon pomeriggio" : "Buonasera") + (S.myName ? ", " + S.myName.split(" ")[0] : "");
  const recent = liveNotes().sort(byUpdated).slice(0, 7);
  const ro = S.readOnly;
  const notesW = `<section class="w wide"><header><h2>Note recenti</h2><button class="link-btn" type="button" data-go="all">Vedi tutte</button></header><div class="mini-notes">${ro ? "" : `<button class="mini new" type="button" data-pg="new-note">${ic("i-plus")}Nuova nota</button>`}${recent.map(miniCard).join("")}</div>${!recent.length ? `<div class="empty-s">Ancora nessuna nota.</div>` : ""}</section>`;
  const open = tasks().filter((x) => !x.done).sort(byDue).slice(0, 7);
  const tasksW = `<section class="w"><header><h2>Attività</h2><button class="link-btn" type="button" data-go="tasks">Apri</button></header>${ro ? "" : `<form class="add-row" data-form="quick-task"><input class="field" name="t" type="text" placeholder="Aggiungi un'attività e premi Invio" autocomplete="off" aria-label="Nuova attività"></form>`}<div class="rows">${open.length ? open.map(taskRow).join("") : `<div class="empty-s">Nessuna attività da fare.</div>`}</div></section>`;
  const up = agenda(todayStr(), 14).slice(0, 7);
  const calW = `<section class="w"><header><h2>Prossimi 14 giorni</h2><button class="link-btn" type="button" data-go="calendar">Calendario</button></header><div class="rows">${up.length ? up.map(agendaRow).join("") : `<div class="empty-s">Niente in programma.${ro ? "" : ` <button class="link-btn" type="button" data-pg="new-event">Aggiungi un evento</button>`}</div>`}</div></section>`;
  const rems = activeReminders().slice(0, 7);
  const remW = rems.length ? `<section class="w"><header><h2>Promemoria</h2><button class="link-btn" type="button" data-go="reminders">Tutti</button></header><div class="rows">${rems.map((n) => `<div class="row-i"><span class="due${n.reminder < Date.now() ? " late" : ymd(new Date(n.reminder)) === todayStr() ? " today" : ""}">${esc(remLabel(n.reminder))}</span><button class="grow" type="button" data-note="${esc(n.id)}">${esc(n.title || "Senza titolo")}</button>${ro ? "" : `<button class="link-btn" type="button" data-rem-done="${esc(n.id)}">Fatto</button>`}</div>`).join("")}</div></section>` : "";
  const sc = shortcutItems().slice(0, 10);
  const scW = `<section class="w"><header><h2>Scorciatoie</h2></header><div class="rows">${sc.length ? sc.map((s) => `<div class="row-i">${ic(scIcon[s.t], "ic sm")}<button class="grow" type="button" ${scAttr(s)}>${esc(s.label)}</button></div>`).join("") : `<div class="empty-s">Tocca la stella in una nota, o fai clic destro su un taccuino o un tag nel menu.</div>`}</div></section>`;
  const padW = `<section class="w"><header><h2>Blocco appunti</h2>${ro ? "" : `<button class="link-btn" type="button" data-pg="scratch-note">Trasforma in nota</button>`}</header><textarea class="scratch" id="scratch" placeholder="Annota qualcosa al volo…" aria-label="Blocco appunti"${ro ? " readonly" : ""}>${esc(P().scratch || "")}</textarea></section>`;
  const tags = allTags(), tl = [...tags.keys()].sort((a, b) => tags.get(b) - tags.get(a)).slice(0, 30);
  const tagW = `<section class="w"><header><h2>Tag</h2><button class="link-btn" type="button" data-go="tags">Gestisci</button></header>${tl.length ? `<div class="tag-cloud">${tl.map((t) => `<button type="button" data-tag="${esc(t)}">${esc(t)}<span class="n">${tags.get(t)}</span></button>`).join("")}</div>` : `<div class="empty-s">Nessun tag ancora.</div>`}</section>`;
  return pgHead(greet, "", cap(fLong.format(new Date()))) + `<div class="widgets">${notesW}${tasksW}${remW}${calW}${scW}${padW}${tagW}</div>`;
}

function pageTasks() {
  const list = tasks(), t0 = todayStr(), ro = S.readOnly;
  const open = list.filter((x) => !x.done).sort(byDue), done = list.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const groups = [["In ritardo", open.filter((x) => x.due && x.due < t0)], ["Oggi", open.filter((x) => x.due === t0)], ["Prossime", open.filter((x) => x.due && x.due > t0)], ["Senza scadenza", open.filter((x) => !x.due)]];
  let h = pgHead("Attività", "", open.length === 1 ? "1 da fare" : open.length + " da fare");
  if (!ro) h += `<form class="add-row" data-form="task"><input class="field" name="t" type="text" placeholder="Nuova attività…" autocomplete="off" aria-label="Titolo della nuova attività"><input class="field" name="d" type="date" aria-label="Scadenza"><select class="field" name="n" aria-label="Nota collegata">${noteOptions().map((o) => `<option value="${esc(o.value)}">${o.value ? esc(o.label) : "Nessuna nota"}</option>`).join("")}</select><button class="btn primary" type="submit">Aggiungi</button></form>`;
  h += `<section class="w">`;
  groups.forEach(([lbl, arr]) => { if (arr.length) h += `<div class="grp-h">${esc(lbl)} <span class="n">${arr.length}</span></div><div class="rows">${arr.map(taskRow).join("")}</div>`; });
  if (!open.length) h += `<div class="empty-s">Niente da fare.${ro ? "" : " Aggiungi un'attività qui sopra, oppure collegala a una nota dal menu ⋯ della nota."}</div>`;
  if (done.length) { const op = isOpen("done"); h += `<button class="grp-h" type="button" data-toggle="done" aria-expanded="${op}">${ic("i-caret", "ic sm")} Completate <span class="n">${done.length}</span></button>${op ? `<div class="rows">${done.slice(0, 150).map(taskRow).join("")}</div>` : ""}`; }
  h += `</section>`;
  const cl = noteChecklists();
  if (cl.length) {
    h += `<section class="w"><header><h2>Dalle liste di controllo nelle note</h2></header>`;
    cl.forEach((g) => {
      h += `<div class="grp-h">${ic("i-notes", "ic sm")}<button class="link-btn" type="button" data-note="${esc(g.id)}">${esc(g.title)}</button></div><div class="rows">${g.items.map((it) => `<div class="row-i${it.done ? " done" : ""}"><button class="chk${it.done ? " on" : ""}" type="button" data-cl="${esc(g.id)}|${it.i}" aria-pressed="${it.done}" aria-label="${it.done ? "Segna da fare" : "Segna come fatta"}: ${esc(it.text)}"${ro ? " disabled" : ""}></button><span class="grow">${esc(it.text)}</span></div>`).join("")}</div>`;
    });
    h += `</section>`;
  }
  return h;
}

function pageCalendar() {
  if (!S.cal) { const d = new Date(); S.cal = { y: d.getFullYear(), m: d.getMonth() }; }
  const { y, m } = S.cal, first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7, t0 = todayStr();
  const byDay = new Map();
  const push = (k, x) => { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); };
  events().forEach((e) => e.date && push(e.date, { k: "ev", ...e }));
  tasks().forEach((t) => t.due && push(t.due, { k: "task", ...t }));
  activeReminders().forEach((n) => { const d = new Date(n.reminder); push(ymd(d), { k: "rem", id: n.id, time: hm(d), title: n.title || "Senza titolo" }); });
  let cells = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - offset + i), k = ymd(d);
    const items = (byDay.get(k) || []).sort((a, b) => (a.k !== "task" ? a.time || "00" : "99").localeCompare(b.k !== "task" ? b.time || "00" : "99"));
    cells += `<div class="day${d.getMonth() !== m ? " out" : ""}${k === t0 ? " today" : ""}" data-day="${k}" tabindex="0" role="button" aria-label="${esc(fLong.format(d))}${items.length ? ", " + items.length + (items.length === 1 ? " elemento" : " elementi") : ""}${S.readOnly ? "" : ". Premi per aggiungere un evento"}"><span class="num">${d.getDate()}</span>${items.slice(0, 3).map((x) => x.k === "rem"
      ? `<button class="ev rem" type="button" data-note="${esc(x.id)}" title="Promemoria ${esc(x.time)}: ${esc(x.title)}">🔔 ${esc(x.time)} ${esc(x.title)}</button>`
      : x.k === "ev"
      ? `<button class="ev" type="button" data-ev="${esc(x.id)}" title="${esc((x.time ? x.time + " " : "") + (x.title || ""))}">${x.time ? esc(x.time) + " " : ""}${esc(x.title || "Evento")}</button>`
      : `<button class="ev task${x.done ? " done" : ""}" type="button" data-task-edit="${esc(x.id)}" title="Attività: ${esc(x.title || "")}">☐ ${esc(x.title || "Attività")}</button>`).join("")}${items.length > 3 ? `<span class="more-ev">+${items.length - 3} altri</span>` : ""}</div>`;
  }
  const days = new Date(y, m + 1, 0).getDate();
  const ag = agenda(ymd(first), days);
  const acts = `<div class="cal-nav"><button class="btn" type="button" data-cal="today">Oggi</button><button class="icon-btn" type="button" data-cal="prev" aria-label="Mese precedente">${ic("i-back")}</button><button class="icon-btn" type="button" data-cal="next" aria-label="Mese successivo">${ic("i-fwd")}</button>${S.readOnly ? "" : `<button class="btn primary" type="button" data-pg="new-event">${ic("i-plus", "ic sm")}Evento</button>`}</div>`;
  return pgHead(cap(fMonth.format(first)), acts, "Calendario") + `<div class="cal">${cells}</div><section class="w"><header><h2>In questo mese</h2></header><div class="rows">${ag.length ? ag.map(agendaRow).join("") : `<div class="empty-s">Nessun evento o attività con scadenza in questo mese.</div>`}</div></section>`;
}

function pageFiles() {
  const list = [];
  liveNotes().sort(byUpdated).forEach((n) => parsed(n.id, n.html).atts.forEach((a) => list.push({ ...a, noteId: n.id, noteTitle: n.title || "Senza titolo", updatedAt: n.updatedAt })));
  const k = S.filesKind, shown = list.filter((a) => k === "all" || a.kind === k);
  const seg = `<div class="seg" role="group" aria-label="Tipo di file">${[["all", "Tutti"], ["img", "Immagini"], ["doc", "Documenti"]].map(([v, l]) => `<button type="button" data-fk="${v}" class="${k === v ? "on" : ""}" aria-pressed="${k === v}">${l}</button>`).join("")}</div>`;
  const up = !S.readOnly && Store.assets ? `<button class="btn primary" type="button" data-pg="upload">${ic("i-plus", "ic sm")}Carica file</button>` : "";
  const cards = shown.map((a) => `<button class="file" type="button" data-note="${esc(a.noteId)}" title="Apri la nota “${esc(a.noteTitle)}”"><span class="pv">${a.kind === "img" && (a.od || /^https:/.test(a.src)) ? imgTag(a.od ? "od:" + a.od : a.src) : `<span class="ext">${esc(extOf(a.name))}</span>`}</span><span class="meta"><b>${esc(a.name)}</b><small>${esc(a.noteTitle)}${a.size ? " · " + esc(fmtSize(a.size)) : ""}</small></span></button>`).join("");
  return pgHead("File", seg + up, list.length === 1 ? "1 allegato" : list.length + " allegati") + (shown.length ? `<div class="files">${cards}</div>` : `<p class="pg-note">${list.length ? "Nessun file di questo tipo." : "Nessun file. Allega immagini e documenti alle note con 📎 nella barra degli strumenti, oppure usa Carica file."}</p>`);
}

function pageNotebooks() {
  const nbs = notebooks(), live = liveNotes(), ro = S.readOnly;
  const inNb = (id) => live.filter((n) => n.notebookId === id && !n.spaceId);
  const row = (nb) => { const ns = inNb(nb.id), last = ns.reduce((m, n) => Math.max(m, n.updatedAt || 0), 0); return `<tr><td><button class="nm" type="button" data-nb="${esc(nb.id)}">${ic("i-book", "ic sm")}<span>${esc(nb.name || "Senza nome")}</span>${isShortcut("notebook", nb.id) ? ic("i-star", "ic sm star") : ""}</button></td><td class="num">${ns.length}</td><td class="num hide-s">${last ? esc(relDate(last)) : "—"}</td><td class="act"><button class="icon-btn" type="button" data-menu-nb="${esc(nb.id)}" aria-haspopup="menu" aria-label="Azioni per ${esc(nb.name || "taccuino")}">${ic("i-more")}</button></td></tr>`; };
  const stacks = [...new Set(nbs.map((n) => n.stack).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
  let rows = "";
  stacks.forEach((st) => { rows += `<tr class="stack"><td colspan="3">${ic("i-stack", "ic sm")} ${esc(st)}</td><td class="act"><button class="icon-btn" type="button" data-menu-stack="${esc(st)}" aria-haspopup="menu" aria-label="Azioni per la pila ${esc(st)}">${ic("i-more")}</button></td></tr>` + nbs.filter((n) => n.stack === st).map(row).join(""); });
  rows += nbs.filter((n) => !n.stack).map(row).join("");
  const acts = ro ? "" : `<button class="btn primary" type="button" data-pg="new-nb">${ic("i-plus", "ic sm")}Nuovo taccuino</button>`;
  return pgHead("Taccuini", acts, nbs.length === 1 ? "1 taccuino" : nbs.length + " taccuini") + (nbs.length ? `<table class="tbl"><thead><tr><th>Nome</th><th>Note</th><th class="hide-s">Aggiornato</th><th><span hidden>Azioni</span></th></tr></thead><tbody>${rows}</tbody></table><p class="pg-note">Per raggruppare più taccuini in una pila, apri ⋯ › Aggiungi a una pila.</p>` : `<p class="pg-note">Nessun taccuino.</p>`);
}

function pageTags() {
  const m = allTags(), tags = [...m.keys()].sort((a, b) => a.localeCompare(b, "it"));
  const rows = tags.map((t) => `<tr><td><button class="nm" type="button" data-tag="${esc(t)}">${ic("i-tag", "ic sm")}<span>${esc(t)}</span>${isShortcut("tag", t) ? ic("i-star", "ic sm star") : ""}</button></td><td class="num">${m.get(t)}</td><td class="act"><button class="icon-btn" type="button" data-menu-tag="${esc(t)}" aria-haspopup="menu" aria-label="Azioni per il tag ${esc(t)}">${ic("i-more")}</button></td></tr>`).join("");
  return pgHead("Tag", "", tags.length === 1 ? "1 tag" : tags.length + " tag") + (tags.length ? `<table class="tbl"><thead><tr><th>Tag</th><th>Note</th><th><span hidden>Azioni</span></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="pg-note">Nessun tag. Aggiungili dalla riga dei tag sotto il titolo di una nota.</p>`);
}

function pageSpaces() {
  const sps = spaces(), live = liveNotes(), ro = S.readOnly;
  const rows = sps.map((s) => { const ns = live.filter((n) => n.spaceId === s.id); return `<tr><td><button class="nm" type="button" data-space="${esc(s.id)}">${ic("i-space", "ic sm")}<span>${esc(s.name || "Senza nome")}</span></button></td><td class="num">${ns.length}</td><td class="num hide-s">${s.createdBy ? "di " + esc(personName(s.createdBy)) : ""}</td><td class="act"><button class="icon-btn" type="button" data-menu-space="${esc(s.id)}" aria-haspopup="menu" aria-label="Azioni per ${esc(s.name || "spazio")}">${ic("i-more")}</button></td></tr>`; }).join("");
  resolveNames(sps.map((s) => s.createdBy));
  const acts = ro ? "" : `<button class="btn primary" type="button" data-pg="new-space">${ic("i-plus", "ic sm")}Nuovo spazio</button>`;
  return pgHead("Spazi", acts, "Taccuini condivisi") + `<p class="pg-note">Gli spazi sono visibili a tutte le persone con cui condividi Quaderno (menu Condividi). Chi ha accesso come collaboratore può anche scrivere. I tuoi taccuini personali restano privati.</p>` + (sps.length ? `<table class="tbl"><thead><tr><th>Spazio</th><th>Note</th><th class="hide-s">Creato</th><th><span hidden>Azioni</span></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="pg-note">Nessuno spazio.</p>`);
}

function renderPage(force) {
  if (!S.ready || !app.classList.contains("paged")) return;
  const a = document.activeElement;
  if (!force && pagePane.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { S.pageStale = true; return; }
  S.pageStale = false;
  const t = S.filter.type;
  if ((t === "spaces") && !sharedOn()) { S.filter = { type: "all" }; showView(); return; }
  const top = pagePane.scrollTop;
  const h = t === "home" ? pageHome() : t === "tasks" ? pageTasks() : t === "calendar" ? pageCalendar() : t === "files" ? pageFiles() : t === "notebooks" ? pageNotebooks() : t === "tags" ? pageTags() : pageSpaces();
  pagePane.innerHTML = `<div class="pg">${h}</div>`;
  hydrate(pagePane, true);
  pagePane.scrollTop = top;
}

/* ---------- shared click actions (pages, editor links, sidebar kids) ---------- */
function handleAction(b) {
  const d = b.dataset;
  if (d.taskToggle) { toggleTask(d.taskToggle); return true; }
  if (d.taskEdit) { editTask(d.taskEdit); return true; }
  if (d.ev) { editEvent(d.ev); return true; }
  if (d.cl) { const [id, i] = d.cl.split("|"); toggleChecklistItem(id, +i); return true; }
  if (d.remDone) { toggleReminderDone(d.remDone); return true; }
  if (d.rem) { setReminder(d.rem); return true; }
  if (d.note) { goNote(d.note); return true; }
  if (d.nb) { setFilter({ type: "notebook", id: d.nb }); return true; }
  if (d.space) { setFilter({ type: "space", id: d.space }); return true; }
  if (d.tag) { setFilter({ type: "tag", tag: d.tag }); return true; }
  if (d.go) { setFilter(goFilter(d.go)); return true; }
  if (d.toggle) { toggleOpen(d.toggle); return true; }
  return false;
}

/* ---------- toolbar ---------- */
const TOOLS = [
  ["undo", "Annulla (Ctrl+Z)", "i-undo"], ["redo", "Ripeti (Ctrl+Y)", "i-redo"], "|",
  ["p", "Testo normale", "T"], ["h1", "Titolo", "H1"], ["h2", "Sottotitolo", "H2"], "|",
  ["bold", "Grassetto (Ctrl+B)", "B", "t-b"], ["italic", "Corsivo (Ctrl+I)", "I", "t-i"], ["underline", "Sottolineato (Ctrl+U)", "U", "t-u"], ["strike", "Barrato", "S", "t-s"], ["mark", "Evidenzia", "i-hl"], ["color", "Colore del testo", "i-palette"], "|",
  ["ul", "Elenco puntato", "i-ul"], ["ol", "Elenco numerato", "i-ol"], ["check", "Lista di controllo (Ctrl+Shift+C)", "i-check"], ["outdent", "Riduci rientro (Maiusc+Tab)", "i-outdent"], ["indent", "Aumenta rientro (Tab)", "i-indent"], "|",
  ["quote", "Citazione", "i-quote"], ["code", "Blocco di codice", "i-code"], ["table", "Tabella", "i-table"], ["link", "Link (Ctrl+K nel testo)", "i-link"], ["notelink", "Collega un'altra nota", "i-notelink"], ["hr", "Linea divisoria", "i-hr"], ["image", "Immagine", "i-image"], ["attach", "Allega file", "i-clip"], "|",
  ["clear", "Rimuovi formattazione", "i-clear"],
];
$("#toolbar").innerHTML = TOOLS.map((t) => t === "|" ? '<span class="sep"></span>' :
  `<button type="button" data-cmd="${t[0]}" title="${t[1]}" aria-label="${t[1]}"${t[3] ? ` class="${t[3]}"` : ""}>${t[2].startsWith("i-") ? ic(t[2]) : t[2]}</button>`).join("");

function updateImageTool() {
  [["image", "Immagine"], ["attach", "Allega file"]].forEach(([c, l]) => {
    const b = document.querySelector(`[data-cmd="${c}"]`);
    if (b) { b.disabled = !Store.assets; b.title = Store.assets ? l : "Gli allegati sono disponibili quando le note sono salvate nel tuo account"; }
  });
}

function selInBody() {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  return edBody.contains(r.commonAncestorContainer) ? r : null;
}
function closestSel(selector) {
  const r = selInBody();
  if (!r) return null;
  let n = r.startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  const el = n.closest ? n.closest(selector) : null;
  return el && edBody.contains(el) ? el : null;
}
function saveRange() { const r = selInBody(); return r ? r.cloneRange() : null; }
function restoreRange(r) {
  edBody.focus();
  const s = getSelection(); s.removeAllRanges();
  if (r) s.addRange(r);
  else { const nr = document.createRange(); nr.selectNodeContents(edBody); nr.collapse(false); s.addRange(nr); }
}
function exec(cmd, val) { document.execCommand(cmd, false, val); }
function toggleBlock(tag) {
  const b = closestSel("h1,h2,h3,blockquote,pre");
  exec("formatBlock", b && b.tagName === tag.toUpperCase() ? "p" : tag);
}

function placeCaret(el, atStart) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(!!atStart); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
const COLORS = [["c-red", "Rosso"], ["c-orange", "Arancione"], ["c-green", "Verde"], ["c-blue", "Blu"], ["c-purple", "Viola"], ["c-gray", "Grigio"]];
const COLOR_RE = /^c-(red|orange|green|blue|purple|gray)$/;
function colorMenu(btn) {
  const range = saveRange();
  const apply = (c) => {
    restoreRange(range);
    const old = closestSel('span[class^="c-"]');
    if (range && range.collapsed) { if (old) { if (c) old.className = c; else old.replaceWith(...old.childNodes); } else toast("Seleziona prima del testo da colorare."); scheduleSave(); return; }
    if (!range) { toast("Seleziona prima del testo da colorare."); return; }
    if (old && old.textContent === range.toString()) { if (c) old.className = c; else old.replaceWith(...old.childNodes); scheduleSave(); return; }
    // Wrap by hand: insertHTML would turn the class into an inline style.
    const r = selInBody() || range;
    const frag = r.extractContents();
    frag.querySelectorAll('span[class^="c-"]').forEach((s) => s.replaceWith(...s.childNodes));
    const node = c ? Object.assign(document.createElement("span"), { className: c }) : document.createDocumentFragment();
    node.appendChild(frag);
    const first = c ? node : node.firstChild, lastN = c ? node : node.lastChild;
    r.insertNode(node);
    edBody.querySelectorAll('span[class^="c-"]').forEach((s) => { if (!s.textContent) s.remove(); });
    if (first && lastN) { const nr = document.createRange(); nr.setStartBefore(first); nr.setEndAfter(lastN); const s = getSelection(); s.removeAllRanges(); s.addRange(nr); }
    scheduleSave();
  };
  openMenu(btn, [...COLORS.map(([c, l]) => ({ label: l, swatch: c, action: () => apply(c) })), "-", { label: "Colore predefinito", icon: "i-clear", action: () => apply("") }]);
}
function insertTable() {
  const row = (tag) => `<tr>${`<${tag}><br></${tag}>`.repeat(3)}</tr>`;
  exec("insertHTML", `<table><tbody>${row("th")}${row("td")}${row("td")}</tbody></table><p><br></p>`);
}
function tableOp(op) {
  const cell = closestSel("td,th");
  if (!cell) return;
  const row = cell.parentElement, table = cell.closest("table"), idx = [...row.children].indexOf(cell);
  if (op === "row-below") { const nr = document.createElement("tr"); [...row.children].forEach(() => { const td = document.createElement("td"); td.innerHTML = "<br>"; nr.appendChild(td); }); row.after(nr); placeCaret(nr.children[0], true); }
  if (op === "col-right") table.querySelectorAll("tr").forEach((tr) => { const ref = tr.children[idx]; const c = document.createElement(ref && ref.tagName === "TH" ? "th" : "td"); c.innerHTML = "<br>"; if (ref) ref.after(c); else tr.appendChild(c); });
  if (op === "del-row") { if (table.querySelectorAll("tr").length <= 1) table.remove(); else row.remove(); }
  if (op === "del-col") { if (row.children.length <= 1) table.remove(); else table.querySelectorAll("tr").forEach((tr) => { if (tr.children[idx]) tr.children[idx].remove(); }); }
  if (op === "del-table") table.remove();
  scheduleSave();
}
function tableMenu(btn) {
  const range = saveRange();
  const run = (op) => () => { restoreRange(range); tableOp(op); };
  openMenu(btn, [
    { label: "Aggiungi riga sotto", icon: "i-plus", k: "Tab nell'ultima cella", action: run("row-below") },
    { label: "Aggiungi colonna a destra", icon: "i-plus", action: run("col-right") },
    "-",
    { label: "Elimina riga", icon: "i-trash", action: run("del-row") },
    { label: "Elimina colonna", icon: "i-trash", action: run("del-col") },
    { label: "Elimina tabella", icon: "i-trash", danger: true, action: run("del-table") },
  ]);
}
async function addNoteLink() {
  const range = saveRange();
  const opts = liveNotes().filter((n) => n.id !== ed.id).sort(byUpdated).slice(0, 400).map((n) => ({ value: n.id, label: (n.title || "Senza titolo").slice(0, 70) + (containerName(n) ? " — " + containerName(n).slice(0, 30) : "") }));
  if (!opts.length) { toast("Non ci sono altre note da collegare."); return; }
  const r = await dialog({ title: "Collega un'altra nota", text: "Il collegamento apre la nota scelta. Nella nota collegata comparirà “Collegata da”.", fields: [{ name: "id", label: "Nota", type: "select", value: opts[0].value, options: opts }], ok: "Collega" });
  restoreRange(range);
  if (!r) return;
  const target = S.items.get(r.values.id);
  if (!target) return;
  const href = "#nota-" + r.values.id;
  if (range && !range.collapsed) {
    exec("createLink", href);
    edBody.querySelectorAll(`a[href="${href}"]`).forEach((a) => { a.setAttribute("data-note", r.values.id); a.removeAttribute("target"); a.removeAttribute("rel"); });
  } else exec("insertHTML", `<a href="${href}" data-note="${esc(r.values.id)}">${esc(target.title || "Senza titolo")}</a>&nbsp;`);
  scheduleSave();
}

async function runCmd(cmd, btn) {
  if (!ed.id || S.readOnly) return;
  if (cmd !== "image" && cmd !== "attach" && cmd !== "link" && !selInBody()) restoreRange(null);
  switch (cmd) {
    case "undo": exec("undo"); break;
    case "redo": exec("redo"); break;
    case "p": exec("formatBlock", "p"); break;
    case "h1": toggleBlock("h1"); break;
    case "h2": toggleBlock("h2"); break;
    case "quote": toggleBlock("blockquote"); break;
    case "code": toggleBlock("pre"); break;
    case "bold": exec("bold"); break;
    case "italic": exec("italic"); break;
    case "underline": exec("underline"); break;
    case "strike": exec("strikeThrough"); break;
    case "hr": exec("insertHorizontalRule"); break;
    case "clear": exec("removeFormat"); { const m = closestSel("mark"); if (m) m.replaceWith(...m.childNodes); const c = closestSel('span[class^="c-"]'); if (c) c.replaceWith(...c.childNodes); } break;
    case "color": colorMenu(btn || $('[data-cmd="color"]')); return;
    case "table": if (closestSel("td,th")) { tableMenu(btn || $('[data-cmd="table"]')); return; } insertTable(); break;
    case "notelink": await addNoteLink(); break;
    case "indent": if (closestSel("li")) exec("indent"); else { toast("Il rientro si usa negli elenchi: crea prima un elenco."); return; } break;
    case "outdent": if (closestSel("li")) exec("outdent"); else return; break;
    case "ol": exec("insertOrderedList"); break;
    case "ul": {
      const ul = closestSel("ul");
      if (ul && ul.dataset.type === "checklist") { delete ul.dataset.type; ul.querySelectorAll(":scope>li").forEach((li) => delete li.dataset.checked); }
      else exec("insertUnorderedList");
      break;
    }
    case "check": toggleChecklist(); break;
    case "mark": {
      const m = closestSel("mark");
      if (m) { m.replaceWith(...m.childNodes); break; }
      const r = selInBody();
      if (!r || r.collapsed) { toast("Seleziona del testo da evidenziare."); break; }
      const d = document.createElement("div"); d.appendChild(r.cloneContents());
      exec("insertHTML", "<mark>" + d.innerHTML + "</mark>");
      break;
    }
    case "link": await addLink(); break;
    case "image": $("#imgInput").click(); return;
    case "attach": $("#fileInput").click(); return;
  }
  scheduleSave(); updateToolbarState();
}

function toggleChecklist() {
  let ul = closestSel("ul");
  if (ul && ul.dataset.type === "checklist") { exec("insertUnorderedList"); return; }
  if (!ul) exec("insertUnorderedList");
  ul = closestSel("ul");
  if (ul) { ul.dataset.type = "checklist"; ul.querySelectorAll(":scope>li").forEach((li) => { if (!li.dataset.checked) li.dataset.checked = "false"; }); }
}

async function addLink() {
  const existing = closestSel("a");
  if (existing) { const r = document.createRange(); r.selectNodeContents(existing); restoreRange(r); exec("unlink"); return; }
  const range = saveRange();
  let url = await ask({ title: "Inserisci un link", text: "Incolla l'indirizzo della pagina.", input: "https://", ok: "Inserisci" });
  if (!url || url === "https://") { restoreRange(range); return; }
  if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
  restoreRange(range);
  if (!range || range.collapsed) exec("insertHTML", `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>&nbsp;`);
  else exec("createLink", url);
  edBody.querySelectorAll("a:not([target]):not([data-note])").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
}

function updateToolbarState() {
  if (!selInBody()) return;
  const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
  const block = closestSel("h1,h2,h3,blockquote,pre");
  const ul = closestSel("ul"), ol = closestSel("ol");
  const on = {
    bold: q("bold"), italic: q("italic"), underline: q("underline"), strike: q("strikeThrough"),
    h1: block && block.tagName === "H1", h2: block && block.tagName === "H2", quote: !!closestSel("blockquote"), code: !!closestSel("pre"),
    ul: ul && ul.dataset.type !== "checklist", ol: !!ol, check: ul && ul.dataset.type === "checklist", mark: !!closestSel("mark"), link: !!closestSel("a:not([data-note])"),
    notelink: !!closestSel("a[data-note]"), color: !!closestSel('span[class^="c-"]'), table: !!closestSel("table"),
  };
  document.querySelectorAll("#toolbar [data-cmd]").forEach((b) => b.classList.toggle("on", !!on[b.dataset.cmd]));
}

/* ---------- attachments ---------- */
const uploadErr = (e, f) => e && e.code === "quota_exceeded" ? "Spazio esaurito su questo dispositivo: libera spazio e riprova." : `Non riesco ad allegare “${f.name}”.`;
function attachmentHtml(path, name, type, size) {
  if (/^image\//.test(type || "")) return `<img data-od="${esc(path)}" alt="${esc(name)}">`;
  return `<a class="att" data-od="${esc(path)}" data-name="${esc(name)}" data-size="${+size || 0}" contenteditable="false">${esc(name)}</a>`;
}
async function uploadAttachment(file) {
  const r = await Store.assets.upload(file);
  return attachmentHtml(r.path, file.name, file.type, r.sizeBytes || file.size);
}
async function attachFiles(files) {
  if (!files.length || !ed.id || S.readOnly) return;
  if (!Store.assets) { toast("Gli allegati sono disponibili quando le note sono salvate nel tuo account."); return; }
  const noteId = ed.id, range = saveRange();
  for (const file of files) {
    if (file.size > MAX_FILE) { toast(`“${file.name}” è troppo grande: il limite è 100 MB.`); continue; }
    try {
      const snip = await uploadAttachment(file);
      if (ed.id !== noteId) { toast("File salvato, ma la nota è cambiata: riprova nella nota giusta."); return; }
      if (!selInBody()) restoreRange(range);
      exec("insertHTML", file.type.startsWith("image/") ? snip : snip + "&nbsp;");
      hydrate(edBody, false);
      scheduleSave();
      toast(`“${file.name}” allegato` + (Store.mode === "cloud" ? ": lo carico su OneDrive" : ""));
    } catch (e) { toast(uploadErr(e, file)); }
  }
}
async function uploadAsNotes(files) {
  if (!files.length || S.readOnly) return;
  if (!Store.assets) { toast("Gli allegati sono disponibili quando le note sono salvate nel tuo account."); return; }
  for (const file of files) {
    if (file.size > MAX_FILE) { toast(`“${file.name}” è troppo grande: il limite è 100 MB.`); continue; }
    try { const snip = await uploadAttachment(file); newNote({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 120), html: `<p>${snip}</p>` }); }
    catch (e) { toast(uploadErr(e, file)); }
  }
}

/* ---------- paste sanitizing ---------- */
const KEEP = new Set("P BR B STRONG I EM U S STRIKE DEL H1 H2 H3 UL OL LI BLOCKQUOTE PRE CODE A MARK HR TABLE THEAD TBODY TR TD TH".split(" "));
const DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED NOSCRIPT TEMPLATE META LINK SVG MATH FORM INPUT BUTTON SELECT TEXTAREA IMG PICTURE VIDEO AUDIO CANVAS HEAD TITLE".split(" "));
function sanitize(html, rich) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 8) { c.remove(); return; }
      if (c.nodeType !== 1) return;
      const t = c.tagName;
      const odOk = OD_PATH_RE.test(c.getAttribute && c.getAttribute("data-od") || "");
      const richImg = t === "IMG" && (rich || odOk);
      const richAtt = t === "A" && c.classList.contains("att") && ((rich && c.hasAttribute("data-asset")) || odOk);
      const noteLink = t === "A" && /^[\w-]{1,80}$/.test(c.getAttribute("data-note") || "") && c.getAttribute("href") === "#nota-" + c.getAttribute("data-note");
      const colorSpan = t === "SPAN" && COLOR_RE.test(c.getAttribute("class") || "");
      if (DROP.has(t) && !richImg) { c.remove(); return; }
      walk(c);
      if (colorSpan) { [...c.attributes].forEach((a) => { if (a.name !== "class") c.removeAttribute(a.name); }); return; }
      if (noteLink) { [...c.attributes].forEach((a) => { if (a.name !== "href" && a.name !== "data-note") c.removeAttribute(a.name); }); return; }
      if (!KEEP.has(t) && !richImg) {
        if (/^(DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE)$/.test(t) && !c.querySelector("p,div,ul,ol,h1,h2,h3,blockquote,pre,table")) {
          const p = doc.createElement("p"); while (c.firstChild) p.appendChild(c.firstChild); c.replaceWith(p);
        } else if (/^H[4-6]$/.test(t)) {
          const h = doc.createElement("h3"); while (c.firstChild) h.appendChild(c.firstChild); c.replaceWith(h);
        } else c.replaceWith(...c.childNodes);
        return;
      }
      [...c.attributes].forEach((a) => {
        if (t === "A" && a.name === "href" && /^(https?:|mailto:)/i.test(a.value.trim())) return;
        if (richAtt && ((a.name === "href" && /^https:/i.test(a.value.trim())) || (a.name === "data-od" && odOk) || ["class", "data-asset", "data-name", "data-size", "contenteditable"].includes(a.name))) return;
        if (richImg && ((a.name === "src" && !odOk && /^https:/i.test(a.value.trim())) || (a.name === "data-od" && odOk) || a.name === "data-asset" || a.name === "alt")) return;
        if (rich && t === "UL" && a.name === "data-type" && a.value === "checklist") return;
        if (rich && t === "LI" && a.name === "data-checked") return;
        c.removeAttribute(a.name);
      });
      if (t === "A" && c.hasAttribute("href")) { c.setAttribute("target", "_blank"); c.setAttribute("rel", "noopener"); }
      if (richImg && !c.getAttribute("src") && !odOk) c.remove();
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* ---------- export ---------- */
function toMarkdown(title, html) {
  const t = document.createElement("template"); t.innerHTML = html || "";
  const inline = (node) => {
    let s = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) { s += c.textContent; return; }
      if (c.nodeType !== 1) return;
      const g = c.tagName, x = inline(c);
      if (g === "B" || g === "STRONG") s += "**" + x + "**";
      else if (g === "I" || g === "EM") s += "*" + x + "*";
      else if (g === "S" || g === "STRIKE" || g === "DEL") s += "~~" + x + "~~";
      else if (g === "CODE") s += "`" + x + "`";
      else if (g === "MARK") s += "==" + x + "==";
      else if (g === "A" && c.dataset.note) s += "[[" + x + "]]";
      else if (g === "A") s += "[" + x + "](" + new URL(c.getAttribute("href") || "", location.href).href + ")";
      else if (g === "IMG") s += "![](" + new URL(c.getAttribute("src") || "", location.href).href + ")";
      else if (g === "BR") s += "\n";
      else s += x;
    });
    return s;
  };
  const out = [];
  const block = (node) => {
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) { if (c.textContent.trim()) out.push(c.textContent.trim()); return; }
      if (c.nodeType !== 1) return;
      const g = c.tagName;
      if (/^H[1-3]$/.test(g)) out.push("#".repeat(+g[1] + 1) + " " + inline(c).trim());
      else if (g === "UL" || g === "OL") {
        const chk = c.dataset.type === "checklist";
        out.push([...c.children].map((li, i) => (chk ? (li.dataset.checked === "true" ? "- [x] " : "- [ ] ") : g === "OL" ? i + 1 + ". " : "- ") + inline(li).trim()).join("\n"));
      } else if (g === "BLOCKQUOTE") out.push(inline(c).trim().split("\n").map((l) => "> " + l).join("\n"));
      else if (g === "PRE") out.push("```\n" + c.textContent + "\n```");
      else if (g === "HR") out.push("---");
      else if (g === "TABLE") {
        const rows = [...c.querySelectorAll("tr")].map((tr) => "| " + [...tr.children].map((td) => inline(td).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ") + " |");
        if (rows.length) { const n = (rows[0].match(/ \| /g) || []).length + 1; rows.splice(1, 0, "|" + " --- |".repeat(n)); out.push(rows.join("\n")); }
      }
      else if (g === "DIV" && c.querySelector("p,h1,h2,h3,ul,ol,div,blockquote,pre")) block(c);
      else { const s = inline(c).trim(); if (s) out.push(s); }
    });
  };
  block(t.content);
  return "# " + (title || "Senza titolo") + "\n\n" + out.join("\n\n") + "\n";
}

async function exportNote() {
  flushEditor();
  const n = S.items.get(ed.id);
  if (!n) return;
  if (!Store.downloads) { toast("L'esportazione non è disponibile in questa vista."); return; }
  try { await Store.downloads.save({ filename: safeName(n.title, "nota") + ".md", data: toMarkdown(n.title, n.html) }); }
  catch (e) { if (e && e.code !== "dismissed" && e.code !== "declined") toast("Esportazione non riuscita."); }
}
async function exportAll() {
  flushEditor();
  if (!Store.downloads) { toast("L'esportazione non è disponibile in questa vista."); return; }
  const ns = notes().filter((n) => !n.trashed).sort((a, b) => containerName(a).localeCompare(containerName(b), "it") || byUpdated(a, b));
  if (!ns.length) { toast("Non ci sono note da esportare."); return; }
  const md = ns.map((n) => toMarkdown(n.title, n.html).replace(/^# (.*)\n/, (m, t) => `# ${t}\n\n_${containerName(n) || "Senza taccuino"}${(n.tags || []).length ? " · " + n.tags.map((x) => "#" + x).join(" ") : ""} · ${fFull.format(n.updatedAt || Date.now())}_\n`)).join("\n\n---\n\n");
  try { await Store.downloads.save({ filename: "Quaderno " + todayStr() + ".md", data: md }); }
  catch (e) { if (e && e.code !== "dismissed" && e.code !== "declined") toast("Esportazione non riuscita."); }
}

/* ---------- full backup (.json) ---------- */
const BACKUP_KINDS = new Set(["note", "notebook", "task", "event", "space", "prefs"]);
async function exportBackup() {
  flushEditor();
  if (!Store.downloads) { toast("Il backup non è disponibile in questa vista."); return; }
  const items = {};
  for (const [id, d] of S.items) { if (!d || !BACKUP_KINDS.has(d.kind)) continue; const c = { ...d }; delete c._shared; items[id] = c; }
  const data = JSON.stringify({ app: "quaderno", version: 3, exportedAt: new Date().toISOString(), items }, null, 1);
  try { await Store.downloads.save({ filename: "Quaderno backup " + todayStr() + ".json", data }); toast("Backup salvato. Immagini e allegati restano in OneDrive (cartella files): nel backup ci sono i riferimenti."); }
  catch (e) { if (e && e.code !== "dismissed" && e.code !== "declined") toast("Backup non riuscito."); }
}
async function importBackup(file) {
  if (S.readOnly) return;
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { toast("Il file non è un backup valido di Quaderno."); return; }
  const items = obj && obj.app === "quaderno" && obj.items && typeof obj.items === "object"
    ? Object.entries(obj.items).filter(([id, d]) => d && typeof d === "object" && BACKUP_KINDS.has(d.kind) && /^[\w.~:@+-]{1,200}$/.test(id) && (d.kind !== "prefs" || id === "prefs") && (d.kind === "prefs" || id !== "prefs")) : [];
  if (!items.length) { toast("Il backup non contiene note."); return; }
  const nn = items.filter(([, d]) => d.kind === "note").length;
  const ok = await ask({ title: "Ripristinare il backup?", text: `Il file contiene ${nn === 1 ? "1 nota" : nn + " note"} e ${items.length - nn} altri elementi (taccuini, attività, eventi, impostazioni). Gli elementi con lo stesso identificativo verranno sostituiti dalla copia del backup; tutti gli altri restano come sono.`, ok: "Ripristina" });
  if (!ok) return;
  flushEditor();
  let done = 0;
  const files = obj.files && typeof obj.files === "object" ? obj.files : null, adopted = new Map(), fstats = { ok: 0, missing: 0 };
  for (const [id, d0] of items) {
    const d = { ...d0 };
    if (d.kind === "note") { d.html = sanitize(await adoptAssets(String(d.html || ""), files, adopted, fstats), true); d.tags = Array.isArray(d.tags) ? d.tags.map(String).slice(0, 50) : []; }
    if (JSON.stringify(d).length > MAX_DOC) continue;
    Store.put(id, d);
    done++;
    while (Store.inflight.size >= 8) await sleep(150);
    if (done % 25 === 0) { toast(`Ripristino ${done} di ${items.length}…`); renderAll(); }
  }
  showView();
  let msg = done === 1 ? "1 elemento ripristinato" : done + " elementi ripristinati";
  if (fstats.ok) msg += ` · ${fstats.ok} tra immagini e allegati`;
  if (fstats.missing) msg += ` · ${fstats.missing} immagini o allegati non inclusi nel backup`;
  toast(msg);
}
/* Notes from the Claude version keep images and attachments as data-asset ids (served there at /_blob/<id>).
   "Backup completo con immagini" carries their bytes in obj.files: here they become files (OneDrive files/…).
   Without the bytes, a short placeholder says what is missing instead of dropping it silently. */
async function adoptAssets(html, files, adopted, fstats) {
  if (!/data-asset=/.test(html)) return html;
  const t = document.createElement("template"); t.innerHTML = html;
  for (const el of [...t.content.querySelectorAll("img[data-asset], a[data-asset]")]) {
    const aid = el.getAttribute("data-asset") || "";
    const f = files && Object.prototype.hasOwnProperty.call(files, aid) && files[aid] && typeof files[aid].data === "string" ? files[aid] : null;
    const isImg = el.tagName === "IMG";
    const name = String((f && f.name) || el.getAttribute("data-name") || el.getAttribute("alt") || el.textContent.trim() || "allegato").slice(0, 200);
    let rep = "";
    if (f && Store.assets) {
      try {
        if (!adopted.has(aid)) {
          const bytes = b64ToBytes(f.data);
          if (bytes.length > MAX_FILE) throw new Error("too_large");
          const type = String(f.type || (isImg ? "image/png" : "application/octet-stream"));
          adopted.set(aid, Store.assets.upload(new File([bytes], name, { type })).then((up) => ({ ...up, type })));
        }
        const up = await adopted.get(aid);
        rep = attachmentHtml(up.path, name, up.type, up.sizeBytes);
        fstats.ok++;
      } catch (e) { rep = ""; }
    }
    if (!rep) { rep = `<i>[${isImg ? "Immagine" : "Allegato"} “${esc(name)}” non ${isImg ? "inclusa" : "incluso"} nel backup]</i>`; fstats.missing++; }
    const r = document.createElement("template"); r.innerHTML = rep;
    el.replaceWith(r.content);
  }
  return t.innerHTML;
}

/* ---------- assistant (Claude) ---------- */
function updateAiBtn() { const b = $("#btnAI"); if (b) b.hidden = !Store.sample; }
function aiErr(e) {
  const c = e && e.code;
  if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(c)) { Store.sample = null; updateAiBtn(); return "L'assistente non è disponibile: non è stato autorizzato oppure non è attivo per il tuo account."; }
  if (c === "rate_limited") return "Troppe richieste all'assistente. Riprova tra qualche minuto.";
  if (c === "session_expired") return "La sessione è scaduta: accedi di nuovo a Claude e riprova.";
  if (c === "prompt_too_large") return "La nota è troppo lunga per l'assistente.";
  if (c === "refused") return "L'assistente non ha voluto rispondere a questa richiesta.";
  if (c === "invalid_json") return "L'assistente ha risposto in un formato inatteso. Riprova.";
  return "L'assistente non ha risposto. Riprova.";
}
function noteForAI() {
  flushEditor();
  const n = S.items.get(ed.id);
  if (!n) return null;
  const text = (edBody.innerText || "").trim();
  if (!text && !n.title) { toast("La nota è vuota: scrivi qualcosa prima di chiedere all'assistente."); return null; }
  return { n, block: `Titolo: ${n.title || "(senza titolo)"}\n\nTesto della nota:\n<<<\n${text.slice(0, 15000)}\n>>>` };
}
async function aiStream(title, prompt, okLabel, onOk) {
  if (!Store.sample) return;
  const ctl = new AbortController();
  let result = null;
  const pr = dialog({ title, text: "Sto pensando…", ok: okLabel, cancel: "Chiudi" });
  const p = $("#modalText"), okBtn = $("#modalOk");
  p.className = "ai"; okBtn.disabled = true;
  Store.sample(prompt, { signal: ctl.signal, onText: ({ text }) => { p.textContent = text; } })
    .then((r) => { result = r.text; p.textContent = r.text + (r.truncated ? "\n\n(Risposta interrotta perché troppo lunga.)" : ""); okBtn.disabled = false; })
    .catch((e) => { if (e && e.code === "cancelled") return; p.textContent = (e && e.text ? e.text + "\n\n" : "") + aiErr(e); });
  const v = await pr;
  if (!v) { ctl.abort(); return; }
  if (result && onOk) onOk(result);
}
const linesToList = (text) => `<ul>${text.split(/\n+/).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).map((l) => `<li>${esc(l).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>`).join("")}</ul>`;
async function aiAction(kind) {
  const ctx = noteForAI();
  if (!ctx || S.readOnly || ctx.n.trashed) return;
  const id = ed.id;
  if (kind === "summary") {
    aiStream("Riassunto della nota", `Riassumi in italiano la nota seguente in 3-6 punti elenco brevi e concreti. Rispondi solo con i punti, uno per riga, ognuno che inizia con "- ". Nessun preambolo.\n\n${ctx.block}`, "Inserisci in cima alla nota", (text) => {
      if (ed.id !== id) return;
      edBody.insertAdjacentHTML("afterbegin", `<h3>Riassunto</h3>${linesToList(text)}<hr>`);
      scheduleSave(); toast("Riassunto inserito");
    });
  } else if (kind === "ask") {
    const q = await ask({ title: "Chiedi all'assistente", text: "Fai una domanda su questa nota.", input: "", ok: "Chiedi" });
    if (!q) return;
    aiStream("Risposta", `Rispondi in italiano, in modo chiaro e breve, alla domanda dell'utente usando la nota seguente come contesto. Se la nota non contiene la risposta, dillo.\n\nDomanda: ${q}\n\n${ctx.block}`, "Aggiungi in fondo alla nota", (text) => {
      if (ed.id !== id) return;
      edBody.insertAdjacentHTML("beforeend", `<blockquote><b>${esc(q)}</b><br>${esc(text).replace(/\n/g, "<br>")}</blockquote>`);
      scheduleSave(); toast("Risposta aggiunta");
    });
  } else if (kind === "tags") {
    toast("L'assistente sta leggendo la nota…");
    try {
      const res = await Store.sample.json(`Suggerisci da 2 a 5 tag brevi in italiano, minuscoli, per classificare questa nota. Preferisci, se adatti, questi tag già usati: ${[...allTags().keys()].slice(0, 60).join(", ") || "(nessuno)"}. Rispondi solo con un array JSON di stringhe, ad esempio ["lavoro","idee"].\n\n${ctx.block}`, { modelTier: "quick" });
      const add = (Array.isArray(res) ? res : []).map((t) => String(t).trim().replace(/^#/, "").replace(/,/g, " ").slice(0, 40)).filter(Boolean);
      const n = S.items.get(id);
      if (!n || !add.length) { toast("Nessun tag suggerito."); return; }
      const tags = [...(n.tags || [])];
      const added = [...new Set(add)].filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
      if (!added.length) { toast("La nota ha già i tag giusti."); return; }
      patchNote(id, { tags: [...tags, ...added] }, true);
      toast("Tag aggiunti: " + added.join(", "));
    } catch (e) { toast(aiErr(e)); }
  } else if (kind === "tasks") {
    toast("L'assistente sta cercando le cose da fare…");
    try {
      const res = await Store.sample.json(`Estrai dalla nota le azioni concrete da fare. Oggi è ${todayStr()}. Rispondi solo con un array JSON di oggetti {"titolo": string, "scadenza": "YYYY-MM-DD" oppure null}. Se non ci sono azioni rispondi []. Massimo 12 elementi.\n\n${ctx.block}`, { modelTier: "quick" });
      const list = (Array.isArray(res) ? res : []).map((x) => ({ title: String((x && (x.titolo || x.title)) || "").trim(), due: /^\d{4}-\d{2}-\d{2}$/.test(String(x && (x.scadenza || x.due))) ? String(x.scadenza || x.due) : "" })).filter((x) => x.title).slice(0, 12);
      if (!list.length) { toast("Non ho trovato cose da fare in questa nota."); return; }
      const ok = await ask({ title: `Creare ${list.length === 1 ? "1 attività" : list.length + " attività"}?`, text: list.map((x) => "• " + x.title + (x.due ? "  (" + dueLabel(x.due) + ")" : "")).join("\n") + "\n\nSaranno collegate a questa nota.", ok: "Crea attività" });
      if (!ok) return;
      list.forEach((x) => addTask({ title: x.title, due: x.due, noteId: id }));
      toast(list.length === 1 ? "Attività creata" : list.length + " attività create");
    } catch (e) { toast(aiErr(e)); }
  }
}
function aiMenu(anchor) {
  const n = S.items.get(ed.id);
  const off = !n || S.readOnly || !!n.trashed;
  openMenu(anchor, [
    { head: "Assistente" },
    { label: "Riassumi la nota", icon: "i-spark", disabled: off, action: () => aiAction("summary") },
    { label: "Chiedi qualcosa sulla nota…", icon: "i-search", disabled: off, action: () => aiAction("ask") },
    { label: "Suggerisci tag", icon: "i-tag", disabled: off, action: () => aiAction("tags") },
    { label: "Trova le cose da fare", icon: "i-task", disabled: off, action: () => aiAction("tasks") },
  ], { alignRight: true });
}

/* ---------- readable copies in OneDrive ----------
   Besides its data file, every note is also written as an ordinary web page:
   App/Quaderno/Leggibili/<taccuino>/<titolo> [id].html, with its images and files taken from App/Quaderno/files/.
   They open with a double click on any PC, without Quaderno. The id -> path map is the synced "readmap" record,
   so a rename on any device removes the old copy. */
function safeName(s, fallback) {
  let n = String(s || "").replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n += "_";
  return n || fallback;
}
async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
const fStamp = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
function odFolder(n) {
  if (n.trashed) return "Cestino";
  if (n.isTemplate) return "Modelli";
  return safeName(nbName(n.notebookId), "Senza taccuino");
}
function noteDoc(n, body) {
  const nb = n.trashed ? "Cestino" : containerName(n);
  const meta = [nb ? "Taccuino: " + esc(nb) : "", n.createdAt ? "Creata " + esc(fStamp.format(n.createdAt)) : "", n.updatedAt ? "Modificata " + esc(fStamp.format(n.updatedAt)) : ""].filter(Boolean).join(" · ");
  const tags = (n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.title || "Senza titolo")}</title><style>
body{font:17px/1.65 Georgia,"Times New Roman",serif;max-width:740px;margin:40px auto;padding:0 16px;color:#1a1f29;background:#fff}
h1.t{font:700 30px/1.2 "Segoe UI",system-ui,sans-serif;margin:0 0 8px}.m{font:13px "Segoe UI",system-ui,sans-serif;color:#646d7e;margin-bottom:28px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tag{background:#eceff4;border-radius:99px;padding:1px 9px}img{max-width:100%;height:auto;border-radius:8px;display:block;margin:.6em 0}a{color:#2f54d4}
a.att{display:inline-block;border:1px solid #e2e6ed;border-radius:8px;padding:3px 10px;font:14px "Segoe UI",system-ui,sans-serif;color:#1a1f29;text-decoration:none}a.att::before{content:"\\1F4CE  "}
blockquote{border-left:3px solid #2f54d4;margin:.8em 0;padding-left:1em;color:#646d7e;font-style:italic}pre{background:#f4f6f9;padding:12px 14px;border-radius:8px;white-space:pre-wrap;font:14px/1.55 Consolas,monospace}
.c-red{color:#c53030}.c-orange{color:#c05621}.c-green{color:#2f855a}.c-blue{color:#2b6cb0}.c-purple{color:#6b46c1}.c-gray{color:#718096}
mark{background:#fff0a3}hr{border:0;border-top:1px solid #e2e6ed;margin:1.4em 0}td,th{border:1px solid #e2e6ed;padding:4px 8px}table{border-collapse:collapse}
ul[data-type=checklist]{list-style:none;padding-left:.2em}ul[data-type=checklist]>li::before{content:"\\2610  "}ul[data-type=checklist]>li[data-checked=true]::before{content:"\\2611  "}ul[data-type=checklist]>li[data-checked=true]{text-decoration:line-through;color:#646d7e}
@media(prefers-color-scheme:dark){body{background:#12151b;color:#e6e9ef}.tag{background:#232835}pre{background:#181c24}mark{background:#5e5316}a{color:#84a0ff}a.att{color:#e6e9ef;border-color:#272c37}}
</style></head><body><h1 class="t">${esc(n.title || "Senza titolo")}</h1><div class="m">${meta}${tags ? " " + tags : ""}</div>
${body}
</body></html>`;
}
/* Rewrites every attachment (images and attached files) through `mapEl(el) -> new url | null` and returns the body HTML. */
async function noteBody(html, mapEl) {
  const t = document.createElement("template");
  t.innerHTML = html || "";
  for (const el of [...t.content.querySelectorAll("img, a[data-asset], a[data-od]")]) {
    let url = null;
    try { url = await mapEl(el); } catch (e) { url = null; }
    if (url) el.setAttribute(el.tagName === "IMG" ? "src" : "href", url);
    if (el.tagName === "A" && el.dataset.name) el.setAttribute("download", el.dataset.name);
    ["data-asset", "data-od", "data-size", "contenteditable"].forEach((a) => el.removeAttribute(a));
  }
  t.content.querySelectorAll("a[data-note]").forEach((a) => { a.removeAttribute("href"); a.removeAttribute("data-note"); });
  return t.innerHTML;
}
async function fetchEl(el) {
  if (el.dataset.od) return Files.blob(el.dataset.od);
  const src = el.getAttribute("src") || el.getAttribute("href");
  if (!src || !/^https:/.test(src)) return null;
  const r = await fetch(src);
  if (!r.ok) throw new Error("http " + r.status);
  return r.blob();
}

const OD = {
  busy: 0, err: "", last: 0, timers: new Map(), queue: Promise.resolve(), retry: new Set(),
  get avail() { return Store.mode === "cloud"; },
  get on() { return Store.mode === "cloud" && P().readable !== false; },
  init() {},
  onPut(id, data, prev) {
    if (!data) return;
    if (data.kind === "note") this.schedule(id);
    else if (data.kind === "notebook" && prev && prev.name !== data.name) notes().filter((n) => n.notebookId === id).forEach((n) => this.schedule(n.id));
  },
  schedule(id) {
    if (!this.on) return;
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.enqueue(id); }, 4000));
  },
  enqueue(id) {
    this.busy++; this.render();
    const p = this.queue.then(() => (this.on ? this.syncNote(id) : false));
    this.queue = p.catch(() => {}).then(() => { this.busy--; this.render(); });
    return p;
  },
  map() { const m = S.items.get("readmap"); return { ...((m && m.paths) || {}) }; },
  async syncNote(id) {
    const n = S.items.get(id), map = this.map(), old = map[id];
    try {
      if (!n || n.kind !== "note") {
        if (old) { await Cloud.Drive.remove("Leggibili/" + old); delete map[id]; Store.put("readmap", { kind: "readmap", paths: map }); }
      } else {
        const folder = odFolder(n);
        const rel = folder + "/" + safeName(n.title, "Senza titolo") + " [" + id + "].html";
        const up = "../".repeat(rel.split("/").length);
        const body = await noteBody(n.html, async (el) => (el.dataset.od ? up + el.dataset.od.split("/").map(encodeURIComponent).join("/") : null));
        await Cloud.Drive.put("Leggibili/" + rel, noteDoc(n, body), { contentType: "text/html" });
        if (old && old !== rel) await Cloud.Drive.remove("Leggibili/" + old);
        if (old !== rel) { map[id] = rel; Store.put("readmap", { kind: "readmap", paths: map }); }
      }
      this.err = ""; this.last = Date.now(); this.retry.delete(id);
      return true;
    } catch (e) {
      this.retry.add(id);
      this.err = e && (e.code === "offline" || e.code === "reauth") ? "" : "non aggiornate";
      return false;
    }
  },
  retryNow() { if (this.on) [...this.retry].forEach((id) => this.enqueue(id)); },
  async syncAll() {
    if (!this.avail) return;
    if (P().readable === false) setPrefs({ readable: true });
    flushEditor();
    const list = notes();
    if (!list.length) { toast("Non ci sono ancora note."); return; }
    toast("Aggiorno le copie leggibili in OneDrive…");
    let ok = 0;
    for (const n of list) if (await this.enqueue(n.id)) ok++;
    toast(ok === list.length ? (ok === 1 ? "1 copia leggibile aggiornata" : ok + " copie leggibili aggiornate") + " in OneDrive › App › Quaderno › Leggibili" : `Aggiornate ${ok} copie su ${list.length}: riprovo appena possibile.`);
  },
  async toggle() {
    const on = P().readable !== false;
    setPrefs({ readable: !on });
    this.render();
    if (on) toast("Copie leggibili disattivate. Quelle già create restano in OneDrive.");
    else this.syncAll();
  },
  async open(id) {
    const rel = this.map()[id];
    if (!rel) { toast(this.on ? "La copia leggibile di questa nota non è ancora pronta: riprova tra qualche secondo." : "Le copie leggibili sono disattivate."); return; }
    try { const m = await Cloud.Drive.meta("Leggibili/" + rel); if (m && m.webUrl) openUrl(m.webUrl); }
    catch (e) { toast("Non riesco ad aprirla adesso."); }
  },
  render() {
    const foot = $("#odFoot");
    if (!foot) return;
    foot.hidden = Store.mode !== "cloud";
    if (foot.hidden) return;
    const dot = $("#odDot"), txt = $("#odText"), btn = $("#odBtn");
    dot.className = "dot"; btn.hidden = true;
    foot.title = "Ogni nota è anche una pagina .html in OneDrive › App › Quaderno › Leggibili: si apre con un doppio clic, anche senza Quaderno.";
    if (P().readable === false) { txt.textContent = "Copie leggibili: disattivate"; return; }
    if (this.busy) { dot.classList.add("busy"); txt.textContent = "Copie leggibili: aggiorno…"; }
    else if (this.retry.size || this.err) { dot.classList.add("err"); txt.textContent = "Copie leggibili: da aggiornare"; btn.hidden = false; btn.textContent = "Riprova"; btn.onclick = () => this.retryNow(); }
    else { dot.classList.add("ok"); txt.textContent = "Copie leggibili in OneDrive"; }
  },
};

/* One note as a single .html file with its images inside, saved where the user wants. */
async function saveToOneDrive() {
  flushEditor();
  const n = S.items.get(ed.id);
  if (!n) return;
  toast("Preparo la pagina con gli allegati…");
  const body = await noteBody(n.html, async (el) => { const b = await fetchEl(el); return b ? "data:" + (b.type || "application/octet-stream") + ";base64," + (await blobToB64(b)) : null; });
  saveBlob(safeName(n.title, "nota") + ".html", noteDoc(n, body), "text/html;charset=utf-8");
  $("#toast").hidden = true;
}

/* ---------- Evernote import (.enex) ---------- */
function md5Hex(bytes) {
  const K = new Int32Array(64), R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const len = bytes.length, nBlocks = ((len + 8) >>> 6) + 1, W = new Int32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) W[i >> 2] |= bytes[i] << ((i % 4) * 8);
  W[len >> 2] |= 0x80 << ((len % 4) * 8);
  W[nBlocks * 16 - 2] = (len * 8) | 0;
  W[nBlocks * 16 - 1] = Math.floor(len / 536870912) | 0;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < W.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = R[(i >> 4) * 4 + (i % 4)];
      const x = (a + f + K[i] + W[o + g]) | 0;
      a = d; d = c; c = b;
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  let hex = "";
  for (const v of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) hex += ((v >>> (i * 8)) & 255).toString(16).padStart(2, "0");
  return hex;
}
function b64ToBytes(s) {
  const bin = atob(String(s || "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function enexDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}
const childText = (el, tag) => { const c = [...el.children].find((x) => x.localName === tag); return c ? c.textContent : ""; };

/* ENML (Evernote's note markup) -> HTML the editor understands. `media(hash, type)` returns the replacement HTML for an attachment. */
async function enmlToHtml(enml, media) {
  const src = String(enml || "")
    .replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<(en-media|en-todo)\b([^>]*?)\/\s*>/gi, "<$1$2></$1>");
  const doc = new DOMParser().parseFromString(src, "text/html");
  const root = doc.querySelector("en-note") || doc.body;
  root.querySelectorAll("en-crypt").forEach((e) => { const p = doc.createElement("p"); p.textContent = "[Testo cifrato in Evernote: non importato]"; e.replaceWith(p); });
  for (const m of [...root.querySelectorAll("en-media")]) {
    const span = doc.createElement("span");
    span.innerHTML = await media((m.getAttribute("hash") || "").toLowerCase(), m.getAttribute("type") || "");
    m.replaceWith(...span.childNodes);
  }
  // Old-style checkboxes: <div><en-todo checked="true"></en-todo>text</div>
  for (const t of [...root.querySelectorAll("en-todo")]) {
    const checked = t.getAttribute("checked") === "true";
    const parent = t.parentElement;
    const block = parent && parent !== root && /^(DIV|P|LI)$/.test(parent.tagName) && parent.querySelectorAll("en-todo").length === 1 ? parent : null;
    if (!block) { t.replaceWith(doc.createTextNode(checked ? "☑ " : "☐ ")); continue; }
    t.remove();
    const li = doc.createElement("li");
    li.setAttribute("data-checked", checked ? "true" : "false");
    while (block.firstChild) li.appendChild(block.firstChild);
    if (block.tagName === "LI") { const ul = block.parentElement; block.replaceWith(li); if (ul && ul.tagName === "UL") ul.setAttribute("data-type", "checklist"); continue; }
    const prev = block.previousElementSibling;
    if (prev && prev.tagName === "UL" && prev.getAttribute("data-type") === "checklist" && prev.dataset.imp === "1") { prev.appendChild(li); block.remove(); }
    else { const ul = doc.createElement("ul"); ul.setAttribute("data-type", "checklist"); ul.dataset.imp = "1"; ul.appendChild(li); block.replaceWith(ul); }
  }
  // New-style checklists: <ul style="--en-todo:true"><li style="--en-checked:true">
  root.querySelectorAll("ul").forEach((ul) => {
    if (!/--en-todo\s*:\s*true/i.test(ul.getAttribute("style") || "")) return;
    ul.setAttribute("data-type", "checklist");
    [...ul.children].forEach((li) => { if (li.tagName === "LI") li.setAttribute("data-checked", /--en-checked\s*:\s*true/i.test(li.getAttribute("style") || "") ? "true" : "false"); });
  });
  // Evernote code blocks
  root.querySelectorAll("div").forEach((d) => {
    if (!/--en-codeblock\s*:\s*true/i.test(d.getAttribute("style") || "")) return;
    const pre = doc.createElement("pre");
    d.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    d.querySelectorAll("div,p").forEach((b) => b.append("\n"));
    pre.textContent = d.textContent.replace(/\n+$/, "");
    d.replaceWith(pre);
  });
  // Highlight spans
  root.querySelectorAll("span[style]").forEach((s) => {
    if (!/--en-highlight|background-color\s*:\s*rgb\(255,\s*2[0-9]{2},\s*[0-9]{1,3}\)/i.test(s.getAttribute("style"))) return;
    const mk = doc.createElement("mark"); while (s.firstChild) mk.appendChild(s.firstChild); s.replaceWith(mk);
  });
  root.querySelectorAll("[data-imp]").forEach((e) => e.removeAttribute("data-imp"));
  return sanitize(root.innerHTML, true);
}

function enexNotes(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement || doc.documentElement.localName !== "en-export") return null;
  return [...doc.documentElement.children].filter((n) => n.localName === "note");
}

async function importEnexNote(noteEl, notebookId, stats) {
  const res = new Map();
  [...noteEl.children].filter((c) => c.localName === "resource").forEach((r, i) => {
    const dataEl = [...r.children].find((c) => c.localName === "data");
    if (!dataEl) return;
    let bytes;
    try { bytes = b64ToBytes(dataEl.textContent); } catch (e) { return; }
    const attrs = [...r.children].find((c) => c.localName === "resource-attributes");
    const name = (attrs && childText(attrs, "file-name")) || "allegato-" + (i + 1);
    res.set(md5Hex(bytes), { bytes, mime: childText(r, "mime") || "application/octet-stream", name });
  });
  const media = async (hash, type) => {
    const r = res.get(hash);
    const name = r ? r.name : "allegato";
    if (r && Store.assets && r.bytes.length <= MAX_FILE) {
      try {
        const up = await Store.assets.upload(new File([r.bytes], name, { type: r.mime }));
        if (/^image\//.test(r.mime)) { stats.images++; return attachmentHtml(up.path, name, r.mime, up.sizeBytes); }
        stats.files++;
        return `<p>${attachmentHtml(up.path, name, r.mime, up.sizeBytes || r.bytes.length)}</p>`;
      } catch (e) {
        if (/^image\//.test(r.mime)) { stats.failedImages++; return `<p>[Immagine “${esc(name)}” non caricata]</p>`; }
      }
    }
    stats.attachments++;
    return `<p>📎 ${esc(name)} <i>(allegato di Evernote non importato)</i></p>`;
  };
  const title = childText(noteEl, "title").trim().slice(0, 300);
  const html = await enmlToHtml(childText(noteEl, "content"), media);
  const tags = [...new Set([...noteEl.children].filter((c) => c.localName === "tag").map((t) => t.textContent.trim().slice(0, 40)).filter(Boolean))];
  const created = enexDate(childText(noteEl, "created")) || Date.now();
  const updated = enexDate(childText(noteEl, "updated")) || created;
  const na = [...noteEl.children].find((c) => c.localName === "note-attributes");
  const remAt = na ? enexDate(childText(na, "reminder-time")) : 0;
  const remDone = na ? !!enexDate(childText(na, "reminder-done-time")) : false;
  const data = { kind: "note", title, html, notebookId, tags, pinned: false, trashed: false, reminder: remAt || null, reminderDone: remAt ? remDone : false, createdAt: created, updatedAt: updated, source: "evernote", importKey: norm(title) + "|" + created };
  if (JSON.stringify(data).length > MAX_DOC) {
    const t = document.createElement("template"); t.innerHTML = html;
    t.content.querySelectorAll("p,li,h1,h2,h3,div,blockquote,pre,br,tr").forEach((e) => e.append("\n"));
    const lines = (t.content.textContent || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    data.html = lines.map((l) => "<p>" + esc(l) + "</p>").join("");
    if (JSON.stringify(data).length > MAX_DOC) data.html = data.html.slice(0, MAX_DOC - 20000).replace(/<[^>]*$/, "") + "<p><i>[Nota troppo lunga: il resto non è stato importato]</i></p>";
    stats.shortened++;
  }
  return data;
}

let importing = false;
async function importEnexFiles(files) {
  if (S.readOnly || importing || !files.length) return;
  importing = true;
  flushEditor();
  const stats = { notes: 0, skipped: 0, images: 0, files: 0, failedImages: 0, attachments: 0, shortened: 0, badFiles: [] };
  const known = new Set(notes().map((n) => n.importKey).filter(Boolean));
  let lastNb = null;
  try {
    for (const file of files) {
      let list = null;
      try { list = enexNotes(await file.text()); } catch (e) { list = null; }
      if (!list) { stats.badFiles.push(file.name); continue; }
      const nbLabel = (file.name.replace(/\.enex$/i, "").trim() || "Evernote").slice(0, 80);
      let nb = notebooks().find((b) => norm(b.name) === norm(nbLabel));
      if (!nb) { const id = newId("b"); Store.put(id, { kind: "notebook", name: nbLabel, createdAt: Date.now() }); nb = { id }; }
      lastNb = nb.id;
      for (let i = 0; i < list.length; i++) {
        toast(`Importo “${nbLabel}”: ${i + 1} di ${list.length}…`);
        const data = await importEnexNote(list[i], nb.id, stats);
        if (known.has(data.importKey)) { stats.skipped++; continue; }
        known.add(data.importKey);
        Store.put(newId("n"), data);
        stats.notes++;
        while (Store.inflight.size >= 8) await sleep(150);
        if (stats.notes % 20 === 0) renderAll();
      }
    }
  } finally { importing = false; }
  const parts = [stats.notes === 1 ? "1 nota importata" : stats.notes + " note importate"];
  if (stats.images) parts.push(stats.images + " immagini");
  if (stats.files) parts.push(stats.files + " file allegati");
  if (stats.skipped) parts.push(stats.skipped + " già presenti saltate");
  if (stats.attachments) parts.push(stats.attachments + " allegati non importati");
  if (stats.failedImages) parts.push(stats.failedImages + " immagini non caricate");
  if (stats.shortened) parts.push(stats.shortened + " note semplificate perché troppo lunghe");
  if (stats.badFiles.length) parts.push("file non validi: " + stats.badFiles.join(", "));
  if (lastNb) setFilter({ type: "notebook", id: lastNb }); else renderAll();
  await ask({ title: stats.notes ? "Importazione completata" : "Nessuna nota importata", text: parts.join(" · ") + ".", ok: "OK" });
}

async function startImport() {
  if (S.readOnly) return;
  closeDrawer();
  const go = await ask({ title: "Importa da Evernote", text: "Nell'app desktop di Evernote, fai clic destro su un taccuino → Esporta taccuino → formato ENEX. Poi scegli qui uno o più file .enex: ognuno diventa un taccuino con lo stesso nome. Immagini e allegati (PDF, testo, video…) vengono importati; i formati non supportati restano solo come nome.", ok: "Scegli file .enex" });
  if (go) $("#enexInput").click();
}

/* ---------- samples (only on request) ---------- */
function addSamples() {
  if (S.readOnly) return;
  const now = Date.now(), nb = newId("b");
  Store.put(nb, { kind: "notebook", name: "Esempi", createdAt: now });
  const mk = (title, html, tags, extra = {}) => {
    const id = newId("n");
    Store.put(id, { kind: "note", title, html, notebookId: nb, tags, pinned: false, trashed: false, createdAt: now - (extra.ago || 0), updatedAt: now - (extra.ago || 0), ...extra.p });
    return id;
  };
  mk("Idee per il weekend", "<h2>Sabato</h2><p>Mercato contadino la mattina, poi giro in bici lungo il fiume.</p><h2>Domenica</h2><blockquote>Prenotare il ristorante entro venerdì.</blockquote><p>Libri da portare: <i>Le città invisibili</i>, quaderno degli schizzi.</p>", ["personale"], { ago: 7200000 });
  const shop = mk("Lista della spesa", '<ul data-type="checklist"><li data-checked="true">Pane integrale</li><li data-checked="false">Pomodori San Marzano</li><li data-checked="false">Parmigiano 24 mesi</li><li data-checked="false">Caffè</li></ul>', ["casa"], { ago: 3600000, p: { pinned: true, reminder: now + 3 * 3600000, reminderDone: false } });
  const first = mk("Benvenuto in Quaderno (esempio)", `<p>Questa è una <b>nota di esempio</b>. Puoi modificarla, spostarla in un altro taccuino o eliminarla.</p><h2>Cose da provare</h2><ul data-type="checklist"><li data-checked="true">Creare una nota con <b>Alt+N</b></li><li data-checked="false">Aggiungere un tag qui sopra</li><li data-checked="false">Cercare con <b>Ctrl+K</b>, anche con <code>tag:casa</code> o <code>todo:false</code></li><li data-checked="false">Evidenziare una <mark>parola importante</mark> o <span class="c-blue">colorarla</span></li><li data-checked="false">Impostare un promemoria con la campanella in alto</li></ul><p>Questa nota rimanda alla <a href="#nota-${shop}" data-note="${shop}">Lista della spesa</a>: aprila e in fondo vedrai “Collegata da”.</p><table><tbody><tr><th>Scorciatoia</th><th>Cosa fa</th></tr><tr><td>Alt+N</td><td>Nuova nota</td></tr><tr><td>Ctrl+K</td><td>Cerca</td></tr><tr><td>Tab</td><td>Cella successiva / rientro</td></tr></tbody></table><p>Le note si salvano da sole mentre scrivi.</p>`, ["guida"]);
  addTask({ title: "Prenotare il ristorante", due: addDays(todayStr(), 1) });
  addTask({ title: "Comprare il caffè", noteId: shop });
  addEvent({ title: "Mercato contadino", date: addDays(todayStr(), (13 - new Date().getDay()) % 7 || 7), time: "09:00" });
  S.filter = { type: "notebook", id: nb };
  showView();
  openNote(first);
}

/* ---------- ready ---------- */
function onReady() {
  S.ready = true;
  $("#sort").value = S.sort;
  if (lsGet("quaderno.rail") === "1") app.classList.add("rail");
  showView();
  if (!isNarrow()) {
    const last = lsGet("quaderno.last");
    const vis = visibleNotes();
    const pick = vis.find((n) => n.id === last) || vis[0];
    if (pick) openNote(pick.id);
  }
  updateImageTool();
  updateSync();
}

/* ---------- events ---------- */
$("#btnNew").onclick = (e) => newMenu(e.currentTarget);
$("#btnNew2").onclick = () => newNote();
$("#btnSearch").onclick = () => openPalette();
$("#btnAcct").onclick = (e) => acctMenu(e.currentTarget);
$("#btnCollapse").onclick = toggleRail;
$("#enexInput").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; importEnexFiles(fs); });
$("#btnMenu").onclick = openDrawer;
$("#scrim").onclick = closeDrawer;
$("#btnBack").onclick = () => { flushEditor(); discardIfEmpty(ed.id); setView("list"); renderList(); };

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.add === "nb") { addNotebook(); return; }
  if (b.dataset.add === "space") { addSpace(); return; }
  if (b.id === "btnMoreNav") { openMoreMenu(b); return; }
  if (b.dataset.stack) { setFilter({ type: "notebooks" }); return; }
  handleAction(b);
});
$("#nav").addEventListener("contextmenu", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const pt = { x: e.clientX, y: e.clientY };
  let items = null;
  if (b.dataset.nb) items = notebookMenu(b.dataset.nb);
  else if (b.dataset.space) items = notebookMenu(b.dataset.space);
  else if (b.dataset.tag) items = tagMenu(b.dataset.tag);
  else if (b.dataset.stack) items = stackMenu(b.dataset.stack);
  else if (b.dataset.note) items = [{ label: "Apri", icon: "i-notes", action: () => goNote(b.dataset.note) }, { label: "Togli dalle scorciatoie", icon: "i-star", disabled: S.readOnly, action: () => patchNote(b.dataset.note, { pinned: false }, false) }];
  else if (b.dataset.sec) items = sectionMenu(b.dataset.sec);
  if (!items) return;
  e.preventDefault();
  openMenu(pt, items);
});

pagePane.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) {
    const d = b.dataset;
    if (d.pg === "menu") return openDrawer();
    if (d.pg === "new-note") return newNote();
    if (d.pg === "new-event") return newEvent();
    if (d.pg === "new-nb") return addNotebook();
    if (d.pg === "new-space") return addSpace();
    if (d.pg === "upload") return $("#fileNew").click();
    if (d.pg === "scratch-note") {
      const txt = ($("#scratch") && $("#scratch").value || "").trim();
      if (!txt) { toast("Il blocco appunti è vuoto."); return; }
      setPrefs({ scratch: "" });
      newNote({ title: "Appunti del " + fFull.format(new Date()), html: txt.split(/\n{2,}/).map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("") });
      return;
    }
    if (d.cal) { const c = S.cal; if (d.cal === "today") { const n = new Date(); S.cal = { y: n.getFullYear(), m: n.getMonth() }; } else { const n = new Date(c.y, c.m + (d.cal === "next" ? 1 : -1), 1); S.cal = { y: n.getFullYear(), m: n.getMonth() }; } renderPage(true); return; }
    if (d.fk) { S.filesKind = d.fk; renderPage(true); return; }
    if (d.menuNb) return openMenu(b, notebookMenu(d.menuNb), { alignRight: true });
    if (d.menuSpace) return openMenu(b, notebookMenu(d.menuSpace), { alignRight: true });
    if (d.menuTag) return openMenu(b, tagMenu(d.menuTag), { alignRight: true });
    if (d.menuStack) return openMenu(b, stackMenu(d.menuStack), { alignRight: true });
    if (handleAction(b)) return;
    return;
  }
  const day = e.target.closest("[data-day]");
  if (day && !S.readOnly) newEvent(day.dataset.day);
});
pagePane.addEventListener("keydown", (e) => {
  const day = e.target.closest && e.target.closest("[data-day]");
  if (day && e.target === day && (e.key === "Enter" || e.key === " ") && !S.readOnly) { e.preventDefault(); newEvent(day.dataset.day); }
});
pagePane.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const t = form.elements.t.value.trim();
  if (!t) return;
  addTask({ title: t, due: form.elements.d ? form.elements.d.value : "", noteId: form.elements.n ? form.elements.n.value : "" });
  const kind = form.dataset.form;
  renderPage(true);
  const inp = $(`form[data-form="${kind}"] [name=t]`, pagePane);
  if (inp) inp.focus();
  toast("Attività aggiunta");
});
let scratchTimer;
pagePane.addEventListener("input", (e) => {
  if (e.target.id !== "scratch") return;
  clearTimeout(scratchTimer);
  const v = e.target.value;
  scratchTimer = setTimeout(() => setPrefs({ scratch: v.slice(0, 20000) }), 700);
});
pagePane.addEventListener("focusout", () => setTimeout(() => { if (S.pageStale && !pagePane.contains(document.activeElement)) renderPage(); }, 0));
pagePane.addEventListener("contextmenu", (e) => {
  const b = e.target.closest("[data-nb],[data-tag],[data-space]");
  if (!b) return;
  e.preventDefault();
  openMenu({ x: e.clientX, y: e.clientY }, b.dataset.nb ? notebookMenu(b.dataset.nb) : b.dataset.space ? notebookMenu(b.dataset.space) : tagMenu(b.dataset.tag));
});

$("#edLinks").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) handleAction(b); });

noteList.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) { openNote(card.dataset.id); return; }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  const a = act.dataset.act;
  if (a === "new") newNote();
  else if (a === "samples") addSamples();
  else if (a === "import") startImport();
  else if (a === "from-tpl") newFromTemplate();
});

$("#listActions").addEventListener("click", async (e) => {
  const act = e.target.closest("[data-act]");
  if (!act) return;
  const f = S.filter, a = act.dataset.act;
  if (a === "nb-menu" || a === "space-menu") openMenu(act, notebookMenu(f.id), { alignRight: true });
  else if (a === "from-tpl") newFromTemplate();
  else if (a === "empty-trash") {
    const tr = notes().filter((n) => n.trashed);
    const ok = await ask({ title: "Svuotare il cestino?", text: `${tr.length === 1 ? "1 nota verrà eliminata" : tr.length + " note verranno eliminate"} per sempre. Non potrai recuperarle.`, ok: "Svuota cestino", danger: true });
    if (!ok) return;
    tr.forEach((n) => Store.remove(n.id));
    if (tr.some((n) => n.id === ed.id)) { ed.id = null; S.activeId = null; loadEditor(); }
    renderAll(); toast("Cestino svuotato");
  }
});

$("#search").addEventListener("input", (e) => {
  S.query = e.target.value; renderList();
  if (!isNarrow()) { const vis = visibleNotes(); if (vis.length && !vis.some((n) => n.id === S.activeId)) openNote(vis[0].id); }
});
$("#sort").addEventListener("change", (e) => { S.sort = e.target.value; renderList(); });

edTitle.addEventListener("input", scheduleSave);
edTitle.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); edBody.focus(); } });
edBody.addEventListener("input", () => { scheduleSave(); });
edBody.addEventListener("blur", flushEditor);
edTitle.addEventListener("blur", flushEditor);

function openUrl(href) {
  const tmp = document.createElement("a"); tmp.href = href; tmp.target = "_blank"; tmp.rel = "noopener";
  document.body.appendChild(tmp); tmp.click(); tmp.remove();
}
edBody.addEventListener("click", (e) => {
  const li = e.target.closest('ul[data-type="checklist"] > li');
  if (li && e.target === li && edBody.isContentEditable) {
    const r = li.getBoundingClientRect();
    if (e.clientX - r.left < 26) { li.dataset.checked = li.dataset.checked === "true" ? "false" : "true"; scheduleSave(); e.preventDefault(); return; }
  }
  const nl = e.target.closest("a[data-note]");
  if (nl) { e.preventDefault(); flushEditor(); goNote(nl.dataset.note); return; }
  const att = e.target.closest("a.att");
  if (att) { e.preventDefault(); openAttachment(att); return; }
  const a = e.target.closest("a[href]");
  if (a && (e.ctrlKey || e.metaKey || !edBody.isContentEditable)) { e.preventDefault(); openUrl(a.href); }
});
edBody.addEventListener("mouseover", (e) => {
  const a = e.target.closest("a[href]");
  if (a && !a.title && a.dataset.note) { const t = S.items.get(a.dataset.note); a.title = t ? "Apri la nota “" + (t.title || "Senza titolo") + "”" : "Questa nota non esiste più"; return; }
  if (a && !a.title) a.title = a.classList.contains("att") ? "Apri “" + (a.dataset.name || "file") + "”" + (a.dataset.size ? " (" + fmtSize(+a.dataset.size) + ")" : "") : a.href + " — Ctrl+clic per aprire";
});

edBody.addEventListener("paste", (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...cd.files];
  if (files.length) { e.preventDefault(); attachFiles(files); return; }
  const html = cd.getData("text/html");
  if (html) { e.preventDefault(); exec("insertHTML", sanitize(html)); hydrate(edBody, false); scheduleSave(); }
});
edBody.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault(); });
edBody.addEventListener("drop", (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r) restoreRange(r); }
  attachFiles(files);
});
$("#imgInput").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; attachFiles(f); });
$("#fileInput").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; attachFiles(f); });
$("#fileNew").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; uploadAsNotes(f); });

$("#toolbar").addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
$("#toolbar").addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b && !b.disabled) runCmd(b.dataset.cmd, b); });
edBody.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || !edBody.isContentEditable) return;
  const cell = closestSel("td,th");
  if (cell) {
    e.preventDefault();
    const cells = [...cell.closest("table").querySelectorAll("td,th")];
    const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
    if (i >= cells.length) tableOp("row-below");
    else if (i >= 0) placeCaret(cells[i], false);
    return;
  }
  if (closestSel("li")) { e.preventDefault(); exec(e.shiftKey ? "outdent" : "indent"); scheduleSave(); }
});
document.addEventListener("selectionchange", updateToolbarState);

$("#edNotebook").addEventListener("change", (e) => moveNote(ed.id, e.target.value));
$("#btnStar").onclick = () => { const n = S.items.get(ed.id); if (n) patchNote(ed.id, { pinned: !n.pinned }, false); };
$("#btnNoteMore").onclick = (e) => noteMenu(e.currentTarget);
$("#btnOneDrive").onclick = saveToOneDrive;
$("#btnBell").onclick = () => { if (ed.id) setReminder(ed.id); };
$("#btnAI").onclick = (e) => aiMenu(e.currentTarget);
$("#edBack").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) handleAction(b); });
$("#backupInput").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); });
$("#odBtn").onclick = () => OD.syncAll();
$("#btnTrash").onclick = () => {
  const id = ed.id; if (!id) return;
  patchNote(id, { trashed: true, trashedAt: Date.now() }, false);
  toast("Nota spostata nel cestino");
  if (S.filter.type !== "trash") {
    const vis = visibleNotes();
    if (isNarrow()) { ed.id = null; S.activeId = null; loadEditor(); setView("list"); renderList(); }
    else openNote(vis[0] ? vis[0].id : null);
  } else renderEditorMeta();
};
$("#btnRestore").onclick = () => {
  const n = S.items.get(ed.id); if (!n) return;
  if (!hasContainer(n)) moveNote(ed.id, "nb:" + defaultNotebook());
  patchNote(ed.id, { trashed: false, trashedAt: null }, false);
  toast("Nota ripristinata");
};
$("#btnPurge").onclick = async () => {
  const n = S.items.get(ed.id); if (!n) return;
  const ok = await ask({ title: "Eliminare la nota per sempre?", text: `“${n.title || "Senza titolo"}” verrà cancellata definitivamente. Non potrai recuperarla.`, ok: "Elimina", danger: true });
  if (!ok) return;
  Store.remove(ed.id);
  ed.id = null; S.activeId = null; loadEditor();
  const vis = visibleNotes();
  if (!isNarrow() && vis[0]) openNote(vis[0].id); else { setView("list"); renderAll(); }
  toast("Nota eliminata");
};

/* tags */
function addTag(raw) {
  const t = raw.replace(/^#/, "").replace(/,/g, " ").trim().slice(0, 40);
  if (!t || !ed.id) return;
  const n = S.items.get(ed.id);
  const tags = [...(n.tags || [])];
  if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  tags.push(t);
  patchNote(ed.id, { tags }, true);
}
$("#tagInput").addEventListener("keydown", (e) => {
  const inp = e.target;
  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(inp.value); inp.value = ""; }
  else if (e.key === "Backspace" && !inp.value) {
    const n = S.items.get(ed.id);
    if (n && (n.tags || []).length) patchNote(ed.id, { tags: n.tags.slice(0, -1) }, true);
  }
});
$("#tagInput").addEventListener("change", (e) => { if (e.target.value && [...$("#tagSuggest").options].some((o) => o.value === e.target.value)) { addTag(e.target.value); e.target.value = ""; } });
$("#tagInput").addEventListener("blur", (e) => { if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ""; } });
$("#tagChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rmtag]");
  if (!b) return;
  const n = S.items.get(ed.id);
  const tags = [...(n.tags || [])]; tags.splice(+b.dataset.rmtag, 1);
  patchNote(ed.id, { tags }, true);
});

/* palette */
$("#palInput").addEventListener("input", renderPalette);
$("#palInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); palSelect(pal.sel + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palSelect(pal.sel - 1); }
  else if (e.key === "Enter") { e.preventDefault(); palRun(pal.sel); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePalette(); }
});
$("#palList").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) palRun(+b.dataset.i); });
$("#palette").addEventListener("click", (e) => { if (e.target.id === "palette") closePalette(); });

/* keyboard shortcuts */
document.addEventListener("keydown", (e) => {
  if (!$("#modal").hidden || !$("#palette").hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey && !mod && (e.key === "n" || e.key === "N" || e.code === "KeyN")) { e.preventDefault(); newNote(); }
  else if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (selInBody() && edBody.isContentEditable && !app.classList.contains("paged")) runCmd("link");
    else openPalette();
  }
  else if (mod && e.shiftKey && e.key.toLowerCase() === "c" && selInBody()) { e.preventDefault(); runCmd("check"); }
  else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); flushEditor(); toast("Le note si salvano da sole mentre scrivi."); }
  else if (e.key === "Escape") { closeMenu(); closeDrawer(); }
});

window.addEventListener("beforeunload", flushEditor);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushEditor(); });
setInterval(() => { OD.render(); if (!S.ready) return; if (app.classList.contains("paged")) renderPage(); else { renderList(); const n = ed.id && S.items.get(ed.id); if (n) updateFoot(n); } }, 60000);

setInterval(checkReminders, 30000);
setTimeout(checkReminders, 4000);
try { document.execCommand("defaultParagraphSeparator", false, "p"); document.execCommand("styleWithCSS", false, false); } catch (e) {}
updateImageTool();

/* sign-in screen, sync status, installable app */
$("#btnSignIn").onclick = connectOneDrive;
$("#btnLocal").onclick = () => { lsSet("quaderno.mode", "local"); Store.start("local"); };
$("#syncText").parentElement.addEventListener("click", () => {
  if (Store.needAuth) { flushEditor(); Cloud.Auth.signIn({ hint: (Cloud.Auth.account || {}).username || "" }); }
  else if (Store.mode === "cloud") { Store.syncErr = ""; Store.sync(); }
});
if ("serviceWorker" in navigator && /^(https:|http:\/\/localhost)/.test(location.href)) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.openNote && S.ready) goNote(e.data.openNote); });
}
const startNote = new URLSearchParams(location.search).get("nota");
Store.init().then(() => { if (startNote && S.items.get(startNote)) goNote(startNote); });
})();
