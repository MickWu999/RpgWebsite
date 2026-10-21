/*
 * AI RPG Builder service worker（手寫，不依賴 next-pwa）
 * - 網頁（HTML、RSC）：網路優先，離線時用快取 → 改版後玩家會拿到新版
 * - /_next/static、/assets、/icons：快取優先（檔名含雜湊或內容固定）
 * - /games/：網路優先，離線時用快取 → 玩過的遊戲離線也能玩
 * 只處理同網域 GET；本機 AI bridge（127.0.0.1:8787）等跨網域請求不經過快取。
 */
const CACHE = "rpg-cache-v2";
const PRECACHE = ["/", "/play/", "/manifest.webmanifest", "/icons/icon-192.png", "/games/index.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallbackKey ?? request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(fallbackKey ?? request)) ?? (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // /play/?pack=xxx 等帶參數的頁面共用同一份 HTML
    event.respondWith(networkFirst(request, url.pathname));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
