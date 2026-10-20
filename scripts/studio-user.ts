import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

/**
 * 管理 Studio 開發者帳號（直接寫入雲端 D1）：
 *   npm run studio:user -- add <帳號> [--password <密碼>]   未指定密碼時自動產生一組強密碼（只顯示一次）
 *   npm run studio:user -- reset <帳號> [--password <密碼>]
 *   npm run studio:user -- list
 * 密碼在本機以 PBKDF2-SHA256 雜湊後才寫入，參數與 worker/studio.ts 一致。
 */

const ITERATIONS = 100_000;
const { values, positionals } = parseArgs({ allowPositionals: true, options: { password: { type: "string" }, local: { type: "boolean" } } });
const [command, username] = positionals;
const d1 = (sql: string) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "ai-rpg-studio", values.local ? "--local" : "--remote", "--json", "--command", sql], { encoding: "utf8" });

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

if (command === "list") {
  console.log(JSON.parse(d1("SELECT username, created_at FROM users ORDER BY created_at"))[0].results);
  process.exit(0);
}
if ((command !== "add" && command !== "reset") || !username || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
  console.error("用法：npm run studio:user -- add|reset <帳號（3～32 個英數字、底線、點、連字號）> [--password <密碼>]");
  process.exit(1);
}
const password = values.password ?? b64url(randomBytes(12));
if (password.length < 6) {
  console.error("密碼至少 6 個字元");
  process.exit(1);
}
const salt = b64url(randomBytes(16));
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("hex");
if (command === "add") {
  d1(`INSERT INTO users (id, username, password_hash, password_salt, password_iterations, created_at) VALUES ('usr_${randomUUID()}', '${username}', '${hash}', '${salt}', ${ITERATIONS}, '${new Date().toISOString()}')`);
} else {
  d1(`UPDATE users SET password_hash = '${hash}', password_salt = '${salt}', password_iterations = ${ITERATIONS} WHERE username = '${username}'`);
  d1(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username}')`);
}
console.log(`帳號：${username}`);
if (!values.password) console.log(`密碼：${password}（只顯示這一次，登入後請到「設定」修改）`);
