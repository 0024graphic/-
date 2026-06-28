/* ===================================================================
   sw.js
   オフラインでも開けるようにするためのService Worker。
   キャッシュ名のバージョンを上げると、次回起動時に新しいファイルに
   差し替わる（初心者がファイルを更新した時に古い表示が残らないように）。
=================================================================== */

const CACHE_VERSION = "keiba-pwa-v1";
const ASSETS = [
  "./index.html",
  "./style.css",
  "./logic.js",
  "./storage.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // オフラインかつキャッシュにない場合はindex.htmlを返す（簡易フォールバック）
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
