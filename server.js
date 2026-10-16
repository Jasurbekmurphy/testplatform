"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- database ---------------- */
const db = new Database(path.join(DATA_DIR, "texnikum.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  book TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  members_can_edit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  norm TEXT NOT NULL,
  options TEXT NOT NULL,
  correct INTEGER NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, norm)
);
CREATE INDEX IF NOT EXISTS q_section ON questions(section_id);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  section_id INTEGER,
  total INTEGER NOT NULL,
  right_count INTEGER NOT NULL,
  seconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS r_group ON results(group_id, created_at);
CREATE TABLE IF NOT EXISTS mistakes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, question_id)
);
`);
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes("recovery_hash")) db.exec("ALTER TABLE users ADD COLUMN recovery_hash TEXT");
if (!userCols.includes("is_admin")) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");

/* ---------------- helpers ---------------- */
const norm = s => String(s || "").toLowerCase().replace(/[‘’`ʻʼ']/g, "'").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const now = () => Date.now();
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.randomBytes(6), b => CODE_ABC[b % CODE_ABC.length]).join("");
const str = (v, max) => String(v ?? "").trim().slice(0, max);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = stored.split("$");
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}
// one-time recovery code shown to the user, e.g. "K7QM-3XRP-9TDA"; only its hash is stored
const normRecovery = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function newRecovery(userId) {
  const raw = Array.from(crypto.randomBytes(12), b => CODE_ABC[b % CODE_ABC.length]).join("");
  db.prepare("UPDATE users SET recovery_hash = ? WHERE id = ?").run(hashPassword(raw), userId);
  return raw.match(/.{4}/g).join("-");
}
function setPassword(userId, pw) {
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hashPassword(pw), userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
const tempPassword = () => Array.from(crypto.randomBytes(8), b => CODE_ABC[b % CODE_ABC.length]).join("").toLowerCase();
const PW_RULE = "Parol kamida 6 ta belgidan iborat bo'lsin.";
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const SESSION_DAYS = 60;
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, now());
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

/* ---------------- app ---------------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));

app.use((req, res, next) => {
  const sid = parseCookies(req.headers.cookie).sid;
  req.user = null;
  if (sid) {
    const row = db.prepare(`SELECT u.id, u.name, u.username, u.is_admin, s.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(sid);
    if (row && now() - row.created_at < SESSION_DAYS * 86400e3) req.user = { id: row.id, name: row.name, username: row.username, isAdmin: !!row.is_admin };
  }
  next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: "Avval tizimga kiring." });
const wrap = fn => (req, res, next) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// simple in-memory rate limit for login/register
const hits = new Map();
function limit(key, max, windowMs) {
  const t = now(); const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  arr.push(t); hits.set(key, arr);
  if (arr.length > max) fail(429, "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring.");
}

/* ----- auth ----- */
app.post("/api/register", wrap((req, res) => {
  limit("reg:" + req.ip, 10, 3600e3);
  const name = str(req.body.name, 60), username = str(req.body.username, 30).toLowerCase(), password = String(req.body.password || "");
  if (!name) fail(400, "Ismingizni yozing.");
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) fail(400, "Login 3–30 ta lotin harf, raqam, _ yoki . bo'lsin.");
  if (password.length < 6) fail(400, PW_RULE);
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) fail(409, "Bu login band. Boshqasini tanlang.");
  const info = db.prepare("INSERT INTO users (name, username, pass_hash, created_at) VALUES (?, ?, ?, ?)").run(name, username, hashPassword(password), now());
  const recoveryCode = newRecovery(info.lastInsertRowid);
  setSession(res, info.lastInsertRowid);
  return { user: { id: info.lastInsertRowid, name, username }, recoveryCode };
}));
app.post("/api/login", wrap((req, res) => {
  limit("login:" + req.ip, 20, 600e3);
  const username = str(req.body.username, 30).toLowerCase(), password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || !checkPassword(password, u.pass_hash)) fail(401, "Login yoki parol noto'g'ri.");
  setSession(res, u.id);
  return { user: { id: u.id, name: u.name, username: u.username, isAdmin: !!u.is_admin } };
}));
app.post("/api/logout", wrap((req, res) => {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) db.prepare("DELETE FROM sessions WHERE token = ?").run(sid);
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0");
  return { ok: true };
}));
app.get("/api/me", wrap(req => ({ user: req.user })));

// forgotten password: login + recovery code -> new password (the code is rotated)
app.post("/api/reset-password", wrap((req, res) => {
  limit("reset:" + req.ip, 10, 3600e3);
  const username = str(req.body.username, 30).toLowerCase(), code = normRecovery(req.body.code), password = String(req.body.password || "");
  if (password.length < 6) fail(400, PW_RULE);
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || !u.recovery_hash || code.length !== 12 || !checkPassword(code, u.recovery_hash)) fail(401, "Login yoki tiklash kodi noto'g'ri.");
  setPassword(u.id, password);
  const recoveryCode = newRecovery(u.id);
  setSession(res, u.id);
  return { user: { id: u.id, name: u.name, username: u.username }, recoveryCode };
}));
app.post("/api/me/password", auth, wrap((req, res) => {
  limit("chpw:" + req.user.id, 10, 600e3);
  const current = String(req.body.current || ""), password = String(req.body.password || "");
  const u = db.prepare("SELECT pass_hash FROM users WHERE id = ?").get(req.user.id);
  if (!checkPassword(current, u.pass_hash)) fail(400, "Hozirgi parol noto'g'ri.");
  if (password.length < 6) fail(400, PW_RULE);
  setPassword(req.user.id, password);
  setSession(res, req.user.id);
  return { ok: true };
}));
app.post("/api/me/recovery", auth, wrap(req => {
  limit("chpw:" + req.user.id, 10, 600e3);
  const u = db.prepare("SELECT pass_hash FROM users WHERE id = ?").get(req.user.id);
  if (!checkPassword(String(req.body.password || ""), u.pass_hash)) fail(400, "Parol noto'g'ri.");
  return { recoveryCode: newRecovery(req.user.id) };
}));

/* ----- site admin (made with: node admin.js make-admin <login>) ----- */
const adminOnly = (req, res, next) => req.user?.isAdmin ? next() : res.status(403).json({ error: "Bu bo'lim faqat administrator uchun." });
app.get("/api/admin/users", auth, adminOnly, wrap(req => {
  const q = "%" + str(req.query.q, 60).replace(/[%_]/g, "") + "%";
  const total = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const users = db.prepare(`SELECT u.id, u.name, u.username, u.created_at AS createdAt, u.is_admin AS isAdmin,
      (SELECT COUNT(*) FROM groups g WHERE g.owner_id = u.id) AS groups,
      (SELECT COUNT(*) FROM results r WHERE r.user_id = u.id) AS tests
    FROM users u WHERE u.name LIKE @q OR u.username LIKE @q ORDER BY u.created_at DESC LIMIT 300`).all({ q });
  return { total, users: users.map(u => ({ ...u, isAdmin: !!u.isAdmin })) };
}));
app.post("/api/admin/users/:id/reset-password", auth, adminOnly, wrap(req => {
  const u = db.prepare("SELECT id, is_admin FROM users WHERE id = ?").get(Number(req.params.id));
  if (!u) fail(404, "Foydalanuvchi topilmadi.");
  if (u.id === req.user.id || u.is_admin) fail(403, "Administrator parolini bu yerdan tiklab bo'lmaydi. Profil orqali o'zgartiring.");
  const temp = tempPassword();
  setPassword(u.id, temp);
  return { password: temp };
}));

/* ----- groups ----- */
function loadGroup(code) {
  const g = db.prepare("SELECT * FROM groups WHERE code = ?").get(String(code || "").toUpperCase());
  if (!g) fail(404, "Bunday kodli guruh topilmadi.");
  return g;
}
const isOwner = (g, u) => g.owner_id === u.id;
const canEdit = (g, u) => isOwner(g, u) || (!!g.members_can_edit && !!db.prepare("SELECT 1 FROM members WHERE group_id = ? AND user_id = ?").get(g.id, u.id));
function requireEdit(g, u) { if (!canEdit(g, u)) fail(403, "Bu guruhga savol qo'shishga ruxsatingiz yo'q. Guruh egasidan so'rang."); }
function requireOwner(g, u) { if (!isOwner(g, u)) fail(403, "Buni faqat guruh egasi qila oladi."); }
function joinGroup(g, u) { db.prepare("INSERT OR IGNORE INTO members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(g.id, u.id, now()); }
const qOut = q => ({ id: q.id, sectionId: q.section_id, text: q.text, options: JSON.parse(q.options), correct: q.correct, explanation: q.explanation, attempts: q.attempts, wrong: q.wrong, createdAt: q.created_at });

app.get("/api/groups", auth, wrap(req => {
  const rows = db.prepare(`
    SELECT g.code, g.name, g.book, g.owner_id = @uid AS mine,
      (SELECT COUNT(*) FROM sections s WHERE s.group_id = g.id) AS sections,
      (SELECT COUNT(*) FROM questions q WHERE q.group_id = g.id) AS questions,
      (SELECT COUNT(*) FROM members m2 WHERE m2.group_id = g.id) AS members
    FROM groups g JOIN members m ON m.group_id = g.id AND m.user_id = @uid
    ORDER BY m.joined_at DESC`).all({ uid: req.user.id });
  return { groups: rows.map(r => ({ ...r, mine: !!r.mine })) };
}));

app.post("/api/groups", auth, wrap(req => {
  const name = str(req.body.name, 100); if (!name) fail(400, "Guruh nomini yozing.");
  const book = str(req.body.book, 150);
  const titles = (Array.isArray(req.body.sections) ? req.body.sections : []).map(t => str(t, 150)).filter(Boolean).slice(0, 300);
  let code; do { code = newCode(); } while (db.prepare("SELECT 1 FROM groups WHERE code = ?").get(code));
  db.transaction(() => {
    const info = db.prepare("INSERT INTO groups (code, name, book, owner_id, members_can_edit, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(code, name, book, req.user.id, req.body.membersCanEdit ? 1 : 0, now());
    const gid = info.lastInsertRowid;
    db.prepare("INSERT INTO members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(gid, req.user.id, now());
    const ins = db.prepare("INSERT INTO sections (group_id, title, position) VALUES (?, ?, ?)");
    const seen = new Set(); let pos = 0;
    for (const t of titles) { const n = norm(t); if (seen.has(n)) continue; seen.add(n); ins.run(gid, t, pos++); }
  })();
  return { code };
}));

app.get("/api/groups/:code", auth, wrap(req => {
  const g = loadGroup(req.params.code);
  joinGroup(g, req.user);
  const sections = db.prepare("SELECT id, title FROM sections WHERE group_id = ? ORDER BY position, id").all(g.id);
  const questions = db.prepare("SELECT * FROM questions WHERE group_id = ? ORDER BY created_at, id").all(g.id).map(qOut);
  const mistakes = db.prepare("SELECT m.question_id AS id, m.count FROM mistakes m JOIN questions q ON q.id = m.question_id WHERE m.user_id = ? AND q.group_id = ?").all(req.user.id, g.id);
  const owner = db.prepare("SELECT name FROM users WHERE id = ?").get(g.owner_id);
  return {
    group: { code: g.code, name: g.name, book: g.book, membersCanEdit: !!g.members_can_edit, ownerName: owner?.name || "" },
    role: { owner: isOwner(g, req.user), canEdit: canEdit(g, req.user) },
    sections, questions, mistakes
  };
}));

app.patch("/api/groups/:code", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireOwner(g, req.user);
  const name = req.body.name !== undefined ? str(req.body.name, 100) || g.name : g.name;
  const book = req.body.book !== undefined ? str(req.body.book, 150) : g.book;
  const mce = req.body.membersCanEdit !== undefined ? (req.body.membersCanEdit ? 1 : 0) : g.members_can_edit;
  db.prepare("UPDATE groups SET name = ?, book = ?, members_can_edit = ? WHERE id = ?").run(name, book, mce, g.id);
  return { ok: true };
}));

app.delete("/api/groups/:code", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireOwner(g, req.user);
  db.prepare("DELETE FROM groups WHERE id = ?").run(g.id);
  return { ok: true };
}));

app.delete("/api/groups/:code/membership", auth, wrap(req => {
  const g = loadGroup(req.params.code);
  if (isOwner(g, req.user)) fail(400, "Guruh egasi guruhdan chiqa olmaydi. Uni o'chirishingiz mumkin.");
  db.prepare("DELETE FROM members WHERE group_id = ? AND user_id = ?").run(g.id, req.user.id);
  return { ok: true };
}));

// members list for the group owner, who can reset a member's forgotten password.
// Members who own a group themselves are excluded so one teacher can't take over another's account.
const ownsGroups = id => !!db.prepare("SELECT 1 FROM groups WHERE owner_id = ?").get(id);
app.get("/api/groups/:code/members", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireOwner(g, req.user);
  const rows = db.prepare(`SELECT u.id, u.name, u.username, m.joined_at AS joinedAt FROM members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? ORDER BY u.name COLLATE NOCASE`).all(g.id);
  return { members: rows.map(r => ({ ...r, canReset: r.id !== req.user.id && !ownsGroups(r.id) })) };
}));
app.post("/api/groups/:code/members/:uid/reset-password", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireOwner(g, req.user);
  const uid = Number(req.params.uid);
  if (!db.prepare("SELECT 1 FROM members WHERE group_id = ? AND user_id = ?").get(g.id, uid)) fail(404, "Bu foydalanuvchi guruhda emas.");
  if (uid === req.user.id || ownsGroups(uid)) fail(403, "Bu foydalanuvchining parolini tiklay olmaysiz: u o'z guruhiga ega.");
  const temp = tempPassword();
  setPassword(uid, temp);
  return { password: temp };
}));

/* ----- sections ----- */
function addSections(g, titles) {
  const existing = db.prepare("SELECT id, title FROM sections WHERE group_id = ?").all(g.id);
  const byNorm = new Map(existing.map(s => [norm(s.title), s.id]));
  let pos = (db.prepare("SELECT MAX(position) AS p FROM sections WHERE group_id = ?").get(g.id).p ?? -1) + 1;
  const ins = db.prepare("INSERT INTO sections (group_id, title, position) VALUES (?, ?, ?)");
  let added = 0;
  for (const t of titles) {
    const n = norm(t); if (!n || byNorm.has(n)) continue;
    byNorm.set(n, ins.run(g.id, t, pos++).lastInsertRowid); added++;
  }
  return { added, byNorm };
}
app.post("/api/groups/:code/sections", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireEdit(g, req.user);
  const titles = (Array.isArray(req.body.titles) ? req.body.titles : []).map(t => str(t, 150)).filter(Boolean).slice(0, 300);
  if (!titles.length) fail(400, "Kamida bitta bo'lim nomini yozing.");
  const { added } = db.transaction(() => addSections(g, titles))();
  return { added, skipped: titles.length - added };
}));
function loadSection(id) {
  const s = db.prepare("SELECT s.*, g.code FROM sections s JOIN groups g ON g.id = s.group_id WHERE s.id = ?").get(Number(id));
  if (!s) fail(404, "Bo'lim topilmadi.");
  return s;
}
app.patch("/api/sections/:id", auth, wrap(req => {
  const s = loadSection(req.params.id); requireEdit(loadGroup(s.code), req.user);
  const title = str(req.body.title, 150); if (!title) fail(400, "Bo'lim nomini yozing.");
  db.prepare("UPDATE sections SET title = ? WHERE id = ?").run(title, s.id);
  return { ok: true };
}));
app.post("/api/sections/:id/move", auth, wrap(req => {
  const s = loadSection(req.params.id); const g = loadGroup(s.code); requireEdit(g, req.user);
  const list = db.prepare("SELECT id FROM sections WHERE group_id = ? ORDER BY position, id").all(g.id).map(r => r.id);
  const i = list.indexOf(s.id), j = i + (req.body.dir === "up" ? -1 : 1);
  if (j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  const upd = db.prepare("UPDATE sections SET position = ? WHERE id = ?");
  db.transaction(() => list.forEach((id, k) => upd.run(k, id)))();
  return { ok: true };
}));
app.delete("/api/sections/:id", auth, wrap(req => {
  const s = loadSection(req.params.id); requireEdit(loadGroup(s.code), req.user);
  db.prepare("DELETE FROM sections WHERE id = ?").run(s.id);
  return { ok: true };
}));

/* ----- questions ----- */
function cleanQuestion(body) {
  const text = str(body.text, 2000);
  if (!text) fail(400, "Savol matnini yozing.");
  const options = (Array.isArray(body.options) ? body.options : []).map(o => str(o, 500)).filter(Boolean);
  if (options.length < 2) fail(400, "Kamida 2 ta variant kiriting.");
  if (options.length > 6) fail(400, "Ko'pi bilan 6 ta variant bo'lishi mumkin.");
  if (new Set(options.map(norm)).size !== options.length) fail(400, "Variantlar bir xil bo'lmasligi kerak.");
  const correct = Number(body.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) fail(400, "To'g'ri javobni belgilang.");
  return { text, options, correct, explanation: str(body.explanation, 1000), n: norm(text) };
}
function findDuplicate(gid, n, exceptId = 0) {
  return db.prepare("SELECT q.id, s.title AS section FROM questions q JOIN sections s ON s.id = q.section_id WHERE q.group_id = ? AND q.norm = ? AND q.id != ?").get(gid, n, exceptId);
}
function sectionOf(g, id) {
  const s = db.prepare("SELECT id FROM sections WHERE id = ? AND group_id = ?").get(Number(id), g.id);
  if (!s) fail(400, "Bo'limni tanlang.");
  return s.id;
}
app.post("/api/groups/:code/questions", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireEdit(g, req.user);
  const q = cleanQuestion(req.body); const sid = sectionOf(g, req.body.sectionId);
  const dup = findDuplicate(g.id, q.n);
  if (dup) fail(409, `Rad etildi: bu savol allaqachon bor ("${dup.section}" bo'limida).`);
  const info = db.prepare("INSERT INTO questions (group_id, section_id, text, norm, options, correct, explanation, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(g.id, sid, q.text, q.n, JSON.stringify(q.options), q.correct, q.explanation, req.user.id, now());
  return { id: info.lastInsertRowid };
}));

app.post("/api/groups/:code/questions/bulk", auth, wrap(req => {
  const g = loadGroup(req.params.code); requireEdit(g, req.user);
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 3000) : [];
  const report = { added: 0, duplicates: [], errors: [] };
  db.transaction(() => {
    const newNames = [...new Set(items.map(i => str(i.sectionName, 150)).filter(Boolean))];
    const { byNorm } = addSections(g, newNames);
    const ins = db.prepare("INSERT INTO questions (group_id, section_id, text, norm, options, correct, explanation, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    let t = now();
    items.forEach((it, idx) => {
      try {
        const q = cleanQuestion(it);
        const sid = it.sectionName ? byNorm.get(norm(it.sectionName)) : sectionOf(g, it.sectionId);
        if (!sid) fail(400, "Bo'lim yo'q");
        const dup = findDuplicate(g.id, q.n);
        if (dup) { report.duplicates.push({ row: idx + 1, text: q.text, section: dup.section }); return; }
        ins.run(g.id, sid, q.text, q.n, JSON.stringify(q.options), q.correct, q.explanation, req.user.id, t++);
        report.added++;
      } catch (e) { if (!(e instanceof HttpError)) throw e; report.errors.push({ row: idx + 1, text: str(it.text, 120), error: e.message }); }
    });
  })();
  return report;
}));

function loadQuestion(id) {
  const q = db.prepare("SELECT q.*, g.code FROM questions q JOIN groups g ON g.id = q.group_id WHERE q.id = ?").get(Number(id));
  if (!q) fail(404, "Savol topilmadi.");
  return q;
}
app.put("/api/questions/:id", auth, wrap(req => {
  const old = loadQuestion(req.params.id); const g = loadGroup(old.code); requireEdit(g, req.user);
  const q = cleanQuestion(req.body); const sid = sectionOf(g, req.body.sectionId);
  const dup = findDuplicate(g.id, q.n, old.id);
  if (dup) fail(409, `Rad etildi: bu savol allaqachon bor ("${dup.section}" bo'limida).`);
  db.prepare("UPDATE questions SET section_id = ?, text = ?, norm = ?, options = ?, correct = ?, explanation = ? WHERE id = ?")
    .run(sid, q.text, q.n, JSON.stringify(q.options), q.correct, q.explanation, old.id);
  return { ok: true };
}));
app.delete("/api/questions/:id", auth, wrap(req => {
  const q = loadQuestion(req.params.id); requireEdit(loadGroup(q.code), req.user);
  db.prepare("DELETE FROM questions WHERE id = ?").run(q.id);
  return { ok: true };
}));

/* ----- results ----- */
app.post("/api/groups/:code/results", auth, wrap(req => {
  const g = loadGroup(req.params.code); joinGroup(g, req.user);
  const mode = ["mixed", "section", "mistakes"].includes(req.body.mode) ? req.body.mode : "mixed";
  const answers = (Array.isArray(req.body.answers) ? req.body.answers : []).slice(0, 2000);
  const getQ = db.prepare("SELECT id, correct FROM questions WHERE id = ? AND group_id = ?");
  const bump = db.prepare("UPDATE questions SET attempts = attempts + 1, wrong = wrong + ? WHERE id = ?");
  const addMistake = db.prepare("INSERT INTO mistakes (user_id, question_id, count) VALUES (?, ?, 1) ON CONFLICT(user_id, question_id) DO UPDATE SET count = count + 1");
  const clearMistake = db.prepare("DELETE FROM mistakes WHERE user_id = ? AND question_id = ?");
  let right = 0, total = 0;
  db.transaction(() => {
    for (const a of answers) {
      const q = getQ.get(Number(a.questionId), g.id); if (!q) continue;
      total++;
      const answered = Number.isInteger(a.choice);
      const ok = answered && a.choice === q.correct;
      if (ok) right++;
      if (answered) bump.run(ok ? 0 : 1, q.id);
      if (!ok) addMistake.run(req.user.id, q.id);
      else if (mode === "mistakes") clearMistake.run(req.user.id, q.id);
    }
    if (total) db.prepare("INSERT INTO results (group_id, user_id, mode, section_id, total, right_count, seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(g.id, req.user.id, mode, mode === "section" ? Number(req.body.sectionId) || null : null, total, right, Math.max(0, Math.min(86400, Number(req.body.seconds) || 0)), now());
  })();
  return { total, right };
}));

app.get("/api/groups/:code/results", auth, wrap(req => {
  const g = loadGroup(req.params.code);
  const board = db.prepare(`
    SELECT u.id, u.name, COUNT(*) AS tests, SUM(r.right_count) AS right_sum, SUM(r.total) AS total_sum,
      MAX(r.right_count * 100 / r.total) AS best, MAX(r.created_at) AS last_at
    FROM results r JOIN users u ON u.id = r.user_id WHERE r.group_id = ?
    GROUP BY u.id ORDER BY (SUM(r.right_count) * 1.0 / SUM(r.total)) DESC, tests DESC`).all(g.id);
  const recent = db.prepare(`
    SELECT r.id, u.name, r.user_id AS userId, r.mode, r.section_id AS sectionId, r.total, r.right_count AS "right", r.seconds, r.created_at AS at
    FROM results r JOIN users u ON u.id = r.user_id WHERE r.group_id = ? ORDER BY r.created_at DESC LIMIT 1000`).all(g.id);
  const mine = recent.filter(r => r.userId === req.user.id);
  return { board: board.map(b => ({ ...b, me: b.id === req.user.id })), recent, mine };
}));

/* ----- static ----- */
app.use("/vendor/xlsx.full.min.js", (req, res) => res.sendFile(require.resolve("xlsx/dist/xlsx.full.min.js")));
app.use("/vendor/mammoth.browser.min.js", (req, res) => res.sendFile(path.join(path.dirname(require.resolve("mammoth/package.json")), "mammoth.browser.min.js")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], setHeaders: res => res.setHeader("Cache-Control", "no-cache") }));
app.get(["/g/:code", "/"], (req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(__dirname, "public", "index.html")));

app.use("/api", (req, res) => res.status(404).json({ error: "Topilmadi." }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Fayl juda katta. Uni bir necha qismga bo'ling." });
  console.error(err);
  res.status(500).json({ error: "Serverda xatolik yuz berdi." });
});

// clean expired sessions daily
setInterval(() => db.prepare("DELETE FROM sessions WHERE created_at < ?").run(now() - SESSION_DAYS * 86400e3), 86400e3).unref();

app.listen(PORT, () => console.log(`TestPlatform: http://localhost:${PORT}`));
