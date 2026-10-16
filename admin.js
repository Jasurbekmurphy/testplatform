"use strict";
// Server-side admin tool. Run inside the container, e.g.:
//   docker exec texnikum-test node admin.js users [search]
//   docker exec texnikum-test node admin.js reset <login>
//   docker exec texnikum-test node admin.js make-admin <login>
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const db = new Database(path.join(DATA_DIR, "texnikum.db"));
const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!cols.includes("is_admin")) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");

const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const [cmd, arg = ""] = process.argv.slice(2);
const find = login => db.prepare("SELECT * FROM users WHERE username = ?").get(String(login).toLowerCase()) || die(`Login topilmadi: ${login}`);
function die(msg) { console.error(msg); process.exit(1); }

if (cmd === "users") {
  const q = `%${arg}%`;
  const rows = db.prepare(`SELECT u.username, u.name, u.created_at, u.is_admin, (SELECT COUNT(*) FROM groups g WHERE g.owner_id = u.id) AS groups
    FROM users u WHERE u.name LIKE ? OR u.username LIKE ? ORDER BY u.created_at DESC`).all(q, q);
  for (const r of rows) console.log(`${r.username.padEnd(24)} ${r.name.padEnd(32)} guruhlar: ${r.groups}  ${new Date(r.created_at).toISOString().slice(0, 10)}${r.is_admin ? "  [admin]" : ""}`);
  console.log(`Jami: ${rows.length}`);
} else if (cmd === "reset") {
  const u = find(arg);
  const pw = Array.from(crypto.randomBytes(8), b => ABC[b % ABC.length]).join("").toLowerCase();
  const salt = crypto.randomBytes(16);
  const hash = `scrypt$${salt.toString("hex")}$${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hash, u.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  console.log(`${u.name} (${u.username}) uchun yangi parol: ${pw}`);
} else if (cmd === "make-admin") {
  const u = find(arg);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(u.id);
  console.log(`${u.name} (${u.username}) endi administrator. Saytga qayta kiring.`);
} else {
  console.log("Buyruqlar: users [qidiruv] | reset <login> | make-admin <login>");
}
