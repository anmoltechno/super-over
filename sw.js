// Super Over's service worker: once the game has loaded, it starts instantly and plays offline.
//
// web/deploy.sh stamps VERSION with the build's hash. The engine, scripts and styles carry the same
// stamp in their URLs, so they never change under a URL and are served straight from the cache;
// everything else (the page, the sounds) comes fresh from the network when there is one, and from
// the cache when there isn't.
const VERSION = '3e8390bab3';
const SOUNDS = ['sounds/applause.m4a','sounds/bat_hard.m4a','sounds/bat_soft.m4a','sounds/bed_birds.m4a','sounds/bed_crowd.m4a','sounds/bed_drums.m4a','sounds/bounce.m4a','sounds/catch.m4a','sounds/cheer.m4a','sounds/coin.m4a','sounds/edge.m4a','sounds/groan.m4a','sounds/horns.m4a','sounds/howzat.m4a','sounds/lights.m4a','sounds/lose.m4a','sounds/ooh.m4a','sounds/pad.m4a','sounds/roar.m4a','sounds/rope.m4a','sounds/star.m4a','sounds/stumps.m4a','sounds/swish.m4a','sounds/tap.m4a','sounds/throw.m4a','sounds/toss.m4a','sounds/wicket.m4a','sounds/win.m4a']; // web/deploy.sh lists sounds/*.m4a here
const CACHE = `super-over-${VERSION}`;
const CORE = VERSION === 'dev' ? [] : [
  './', 'manifest.webmanifest', 'icon.png', 'icon-192.png', `style.css?v=${VERSION}`,
  ...['app', 'wasi', 'renderer', 'audio', 'scene3d', 'venue3d', 'figures3d', 'net'].map((name) => `js/${name}.js?v=${VERSION}`),
  // The libraries and the lettering only change with web/vendor.sh, so they keep their own names.
  'js/vendor/three.js', 'js/vendor/peer.js', 'fonts/barlow-condensed-600.woff2', 'fonts/barlow-condensed-700.woff2', 'fonts/barlow-condensed-800i.woff2',
  `super-over.wasm?v=${VERSION}`, ...SOUNDS,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The page registers this after the engine has loaded, so these mostly come from the HTTP cache.
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // A new build's files replace the last one's.
    for (const key of await caches.keys()) {
      if (key.startsWith('super-over-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(url.searchParams.has('v') ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const page = request.mode === 'navigate';
    // Offline, any link into the game (?play=blitz) opens the cached page.
    const hit = (await cache.match(request, { ignoreSearch: page })) || (page ? await cache.match('./', { ignoreSearch: true }) : undefined);
    if (hit) return hit;
    throw error;
  }
}
