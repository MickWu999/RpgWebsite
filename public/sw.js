/*
 * AI RPG Builder service worker（手寫，不依賴 next-pwa）
 * - 網頁（HTML、RSC）：網路優先，離線時用快取 → 改版後玩家會拿到新版
 * - /_next/static、/assets、/icons：快取優先（檔名含雜湊或內容固定）
 * - /games/：網路優先，離線時用快取 → 玩過的遊戲離線也能玩
 * 只處理同網域 GET；本機 AI bridge（127.0.0.1:8787）等跨網域請求、/api/ 不經過快取。
 * 推播：後台送出的推播不帶內容，收到後到 /api/notices/latest 讀最新公告再顯示通知；點通知開啟公告的站內網址。
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
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // /play/?pack=xxx 等帶參數的頁面共用同一份 HTML
    event.respondWith(networkFirst(request, url.pathname));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

const NOTICE_ICONS = { chapter: "📖", update: "✨", fix: "🔧", new_game: "🎮" };

self.addEventListener("push", (event) => {
  event.waitUntil(
    fetch("/api/notices/latest", { cache: "no-store" })
      .then((res) => res.json())
      .then(({ notice }) => {
        // 讀不到公告時仍要顯示通知（瀏覽器規定收到推播一定要顯示）
        const n = notice ?? { kind: "update", title: "有新的消息", body: "點這裡看看", url: "/" };
        return self.registration.showNotification(`${NOTICE_ICONS[n.kind] ?? "📣"} ${n.title}`, {
          body: n.body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: `notice-${n.id ?? "latest"}`,
          data: { url: n.url || "/" },
        });
      })
      .catch(() => self.registration.showNotification("📣 有新的消息", { body: "點這裡看看", icon: "/icons/icon-192.png", data: { url: "/" } })),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const same = list.find((c) => c.url === target);
      if (same) return same.focus();
      return self.clients.openWindow(target);
    }),
  );
});
