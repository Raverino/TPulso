// One command to rebuild the offline timetable: `npm run timetable` (docs/OFFLINE.md).
// Downloads the TML regional GTFS feed (+ operators' own feeds for a cross-check), converts it into
// compact area/route files under public/data/<version>/, validates them and prints a summary.
// Options: --date YYYYMMDD  --days 14  --offline (reuse downloaded feeds)  --skip-cross-check
//          --accept-mismatch (write output even if a cross-check differs by more than the tolerance)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dateInZone, type Manifest, type OperatorInfo } from '../shared/timetable.ts';
import { convert, countTripsOn } from './timetable/convert.ts';
import { download, zipSource } from './timetable/gtfs.ts';
import { CROSS_CHECK_TOLERANCE_PCT, OPERATORS, TML_FEED_URL } from './timetable/operators.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'gtfs');
const OUT = path.join(ROOT, 'public', 'data');
const today = opt('date') ?? dateInZone(Date.now(), 'Europe/Lisbon');
const days = Number(opt('days') ?? 14);
const maxAgeH = flag('offline') ? Infinity : 12;

// Peak memory, sampled while running.
let peakRss = 0;
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 250);
const t0 = Date.now();
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const kb = (b: number) => `${Math.round(b / 1000)} kB`;
const log = (s: string) => console.log(s);
const problems: string[] = [];

async function main() {
  log(`TPulso timetable build — service day ${today}, ${days}-day window`);

  // 1. Feeds
  const tmlZip = path.join(CACHE, 'tml.zip');
  const dl = await download(TML_FEED_URL, tmlZip, maxAgeH);
  log(`• TML regional feed: ${mb(dl.bytes)} ${dl.reused ? '(cached copy)' : '(downloaded)'}`);

  // 2. Convert
  const tml = await zipSource(tmlZip);
  let feedVersion = '';
  for await (const r of tml.source('feed_info.txt')) feedVersion = r.feed_version ?? '';
  const version = `${feedVersion.replace(/[^0-9A-Za-z-]/g, '')}_${today}`;
  const res = await convert(tml.source, { today, days, operators: OPERATORS, version });
  tml.close();
  log(`• Converted: ${res.stats.tripsInWindow} trips (${res.stats.duplicateTrips} exact duplicates merged), ${res.stats.stopTimes} stop times, ${res.stats.patterns} route patterns, ${res.stats.stops} stops; shape points ${res.stats.shapePointsRaw} → ${res.stats.shapePointsKept}`);
  const sd = Object.entries(res.stats.sameDayDuplicates);
  log(`• Same-day duplicate trips (listed twice for the same day): ${sd.length ? sd.map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}; the rest were one trip listed under plans for different dates`);

  // 3. Cross-check with operators' own feeds (today's trip counts)
  const operators: OperatorInfo[] = [];
  for (const o of res.operators) {
    const cfg = OPERATORS.find(c => c.id === o.id)!;
    let crossCheck: OperatorInfo['crossCheck'] = { ownTripsToday: null, diffPct: null, status: 'none', note: 'no separate feed' };
    if (cfg.ownFeed && !flag('skip-cross-check')) {
      try {
        const z = path.join(CACHE, `${o.id}.zip`);
        await download(cfg.ownFeed, z, maxAgeH);
        const own = await zipSource(z);
        const n = await countTripsOn(own.source, today);
        own.close();
        const diffPct = Math.round((Math.abs(n - o.tripsToday) / Math.max(1, n)) * 1000) / 10;
        crossCheck = { ownTripsToday: n, diffPct, status: diffPct <= CROSS_CHECK_TOLERANCE_PCT ? 'ok' : 'mismatch' };
      } catch (e) {
        crossCheck = { ownTripsToday: null, diffPct: null, status: 'unavailable', note: (e as Error).message };
      }
    }
    operators.push({ ...o, crossCheck });
  }
  const mismatches = operators.filter(o => o.crossCheck.status === 'mismatch');
  if (mismatches.length && !flag('accept-mismatch')) {
    problems.push(
      `cross-check differs by more than ${CROSS_CHECK_TOLERANCE_PCT}% for: ` +
        mismatches.map(o => `${o.name} (regional feed ${o.tripsToday} trips today, own feed ${o.crossCheck.ownTripsToday}, ${o.crossCheck.diffPct}%)`).join('; ') +
        ' — re-run with --accept-mismatch to write anyway',
    );
  }

  // 4. Validate
  const tripsToday = new Map<string, number>();
  for (const r of res.routes.values()) tripsToday.set(r.op, (tripsToday.get(r.op) ?? 0) + r.trips.filter(t => t[2] & 1).length);
  for (const o of operators) if (!tripsToday.get(o.id)) problems.push(`${o.name} has no trips today in the output`);
  for (const o of operators) if (o.dateTo < today) problems.push(`${o.name} feed has expired (${o.dateTo})`);
  const excludedIds = new Set(res.excluded.map(e => e.id));
  for (const r of res.routes.values()) if (excludedIds.has(r.op)) { problems.push(`excluded operator ${r.op} present in output`); break; }
  if (!res.areas.size) problems.push('no areas produced');

  // 5. Write (only after validation passed). The app follows current.json, which is updated last,
  //    so a half-written version folder is never used.
  const files: { rel: string; json: string }[] = [];
  const areaSizes: Record<string, number> = {};
  for (const [k, a] of res.areas) {
    const json = JSON.stringify(a);
    areaSizes[k] = json.length;
    files.push({ rel: `areas/${k}.json`, json });
    if (json.length > 2_000_000) problems.push(`area ${k} is ${mb(json.length)} (limit 2 MB)`);
  }
  for (const [id, r] of res.routes) files.push({ rel: `routes/${id}.json`, json: JSON.stringify(r) });
  const manifest: Manifest = {
    format: 1, version, generatedAt: new Date().toISOString(), timezone: 'Europe/Lisbon',
    feed: { url: TML_FEED_URL, version: res.feed.version, publisher: res.feed.publisher },
    window: { first: today, days }, operators, excluded: res.excluded,
    area: { latDeg: 0.02, lngDeg: 0.025 }, areas: areaSizes,
  };
  files.push({ rel: 'manifest.json', json: JSON.stringify(manifest) });

  if (problems.length) {
    log('\n✖ Build stopped, nothing written. Problems:');
    for (const p of problems) log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  const dir = path.join(OUT, version);
  fs.rmSync(dir, { recursive: true, force: true });
  let raw = 0, gz = 0;
  const areaGz: number[] = [];
  let routeGz = 0;
  for (const f of files) {
    const p = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.json);
    const g = zlib.gzipSync(f.json, { level: 9 }).length;
    raw += f.json.length;
    gz += g;
    if (f.rel.startsWith('areas/')) areaGz.push(g);
    else if (f.rel.startsWith('routes/')) routeGz += g;
  }
  fs.writeFileSync(path.join(OUT, 'current.json'), JSON.stringify({ version, manifest: `/data/${version}/manifest.json` }));
  // Keep only the new version.
  for (const d of fs.readdirSync(OUT)) {
    if (d !== version && d !== 'current.json') fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  }

  // 6. Summary
  areaGz.sort((a, b) => a - b);
  const q = (p: number) => areaGz[Math.min(areaGz.length - 1, Math.floor(areaGz.length * p))]!;
  log(`\n✔ Wrote public/data/${version}/  (generated files are git-ignored)`);
  log(`  window ${today} + ${days - 1} days · feed ${res.feed.version} (${res.feed.publisher})`);
  log('\n  Included operators:');
  for (const o of operators) {
    const cc = o.crossCheck;
    const ccText = cc.status === 'ok' || cc.status === 'mismatch' ? `own feed ${cc.ownTripsToday} trips (${cc.diffPct}% diff) ${cc.status === 'ok' ? 'ok' : 'MISMATCH'}` : `cross-check: ${cc.status}${cc.note ? ` (${cc.note})` : ''}`;
    log(`  - ${o.name.padEnd(42)} ${o.modes.join('/').padEnd(10)} ${o.dateFrom}–${o.dateTo}  ${String(o.tripsToday).padStart(5)} trips today · ${ccText}`);
  }
  log('\n  Excluded:');
  for (const e of res.excluded) log(`  - ${e.name}: ${e.reason}`);
  log(`\n  Files: ${files.length} (${res.areas.size} areas, ${res.routes.size} routes, manifest)`);
  log(`  Size: ${mb(raw)} raw, ${mb(gz)} gzip total · areas ${mb(areaGz.reduce((s, x) => s + x, 0))} gzip (median ${kb(q(0.5))}, 90% ≤ ${kb(q(0.9))}, max ${kb(areaGz[areaGz.length - 1]!)}) · routes ${mb(routeGz)} gzip`);
  log(`  Time ${((Date.now() - t0) / 1000).toFixed(0)} s · peak memory ${mb(Math.max(peakRss, process.resourceUsage().maxRSS * 1024))}`);
}

main()
  .catch(e => {
    console.error('\n✖ Build failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(sampler));
