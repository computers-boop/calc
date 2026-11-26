const CACHE = 'concert-planner-mobile-shell-v1';
const SHELL = ['./','./index.html','./styles.css','./app.js','./finance.js',
  './research.js','./manifest.webmanifest','./icons/stage-192.png',
  './icons/stage-512.png','./icons/stage-180.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
