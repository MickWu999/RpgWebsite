import { existsSync } from "node:fs";

/** 本機腳本讀取 .env.local / .env（不覆蓋已存在的環境變數） */
export function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
