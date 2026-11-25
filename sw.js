'use strict';

const CACHE_NAME = 'pinx-app-shell-v1';
const SHELL_PATHS = [
    '',
    'index.html',
    'manifest.json',
    'icon-192.png',
    'icon-512.png',
    'icon.svg',
    'apple-touch-icon.png'
];
const SHELL_URLS = SHELL_PATHS.map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(SHELL_URLS);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter(name => name.startsWith('pinx-app-shell-') && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin ||
            !requestUrl.href.startsWith(self.registration.scope)) return;

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const response = await fetch(request);
                if (response.ok && response.type === 'basic') {
                    await cache.put(self.registration.scope, response.clone());
                }
                return response;
            } catch (error) {
                const cachedPage = await cache.match(self.registration.scope) ||
                    await cache.match(new URL('index.html', self.registration.scope).href);
                if (cachedPage) return cachedPage;
                return new Response('PINX is not available offline yet. Open it once while connected.', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            }
        })());
        return;
    }

    if (!SHELL_URLS.includes(requestUrl.href)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
        return response;
    })());
});
