const CACHE="habitflow-basic-v2";
const FILES=["./","./index.html","./style.css","./app.js","./manifest.json","./icons/icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
	if(e.request.method!=="GET"||new URL(e.request.url).origin!==self.location.origin)return;
	e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request).then(r=>{
		const copy=r.clone();
		caches.open(CACHE).then(c=>c.put(e.request,copy));
		return r;
	}).catch(()=>caches.match("./"))));
});