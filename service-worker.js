const VERSION='v26-20261009031745';
const CACHE='musicxml-reader-'+VERSION;
const CORE=['./','./index.html','./style.css','./app.mjs','./timeline.mjs','./audio.mjs','./library.json','./manifest.webmanifest','./assets/verovio.mjs','./assets/verovio-module.mjs'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);await cache.addAll(CORE);
 const response=await cache.match('./library.json'),library=await response.json();
 const paths=(library.sessions||library).map(s=>s.xml_url).filter(Boolean);
 await Promise.all(paths.map(async path=>{try{await cache.add(path)}catch{}}));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('musicxml-reader-')&&key!==CACHE)await caches.delete(key);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response}catch{return await cache.match(event.request)||new Response('Hors ligne / Offline',{status:503})}})());
});
