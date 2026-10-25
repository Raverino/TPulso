// Captures a consistent snapshot of real Carris Metropolitana API responses into fixtures/.
// Usage: node scripts/capture-fixtures.mjs fixtures   (GTFS extracts in fixtures/gtfs were cut by hand from /v2/gtfs)
import fs from 'node:fs';
const OUT=process.argv[2], B='https://api.carrismetropolitana.pt/v2';
const T={lat:38.72079702815775,lon:-9.146010904277587};
const hav=(a,b,c,d)=>{const R=6371000,t=x=>x*Math.PI/180;const h=Math.sin(t(c-a)/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(t(d-b)/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const meta={captured_at:new Date().toISOString(),source:B,files:{}};
async function get(path,file,transform){const url=B+path;const r=await fetch(url);const ct=r.headers.get('content-type')||'';
  let body=ct.includes('json')?await r.json():Buffer.from(await r.arrayBuffer());const raw=Array.isArray(body)?body.length:undefined;
  if(transform)body=transform(body);
  fs.writeFileSync(OUT+'/'+file,Buffer.isBuffer(body)?body:JSON.stringify(body,null,1));
  meta.files[file]={url,status:r.status,cache_control:r.headers.get('cache-control'),items_in_response:raw,items_saved:Array.isArray(body)?body.length:undefined};return body;}
const vehicles=await get('/vehicles','vehicles.json');
await get('/vehicles.pb','vehicles.pb');
const allStops=await (await fetch(B+'/stops')).json();
await get('/stops','stops.near-test-1500m.json',s=>s.filter(x=>hav(T.lat,T.lon,x.lat,x.lon)<=1500));
meta.files['stops.near-test-1500m.json'].note='Subset of /v2/stops (full response ~6.8 MB): stops within 1500 m of the TEST location. Records are unmodified.';
const sid=new Set(allStops.map(s=>s.id));
// Pick the live vehicle closest to TEST whose next stop exists in /v2/stops.
const v=vehicles.filter(x=>sid.has(x.stop_id)).sort((a,b)=>hav(T.lat,T.lon,a.lat,a.lon)-hav(T.lat,T.lon,b.lat,b.lon))[0];
meta.chosen_vehicle={id:v.id,trip_id:v.trip_id,pattern_id:v.pattern_id,stop_id:v.stop_id,line_id:v.line_id};
await get('/arrivals/by_stop/'+v.stop_id,`arrivals.by_stop.${v.stop_id}.json`);
await get('/arrivals/by_stop/060033',`arrivals.by_stop.060033.json`);
meta.files['arrivals.by_stop.060033.json'].note='Marquês de Pombal (Metro) P1 — nearest TML stop to the TEST location (~730 m).';
// /v2/patterns uses the un-prefixed pattern id (e.g. 1249_0_2); the vehicle carries "[PLAN][AGENCY]1249_0_2".
const pid=v.pattern_id.replace(/^(\[[^\]]+\])+/,'');
const pat=await get('/patterns/'+pid,`pattern.${pid}.json`);
meta.files[`pattern.${pid}.json`].note=`Fetched with id "${pid}" derived from vehicle.pattern_id "${v.pattern_id}" by removing the bracket prefixes — no exact-key endpoint exists.`;
const shapeId=pat[0].shape_id;
await get('/shapes/'+encodeURIComponent(shapeId),`shape.${shapeId.replace(/[\[\]]/g,'_')}.json`);
await get('/lines','lines.json');
await get('/routes','routes.json');
await get('/plans','plans.json');
fs.writeFileSync(OUT+'/_meta.json',JSON.stringify(meta,null,1));
console.log(JSON.stringify(meta,null,1));
