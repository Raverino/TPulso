// Reading GTFS: download, and CSV rows streamed straight out of the zip (stop_times is ~1 GB unzipped).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';

export type Row = Record<string, string>;
/** Yields the rows of one GTFS file, or nothing when the file is absent. */
export type GtfsSource = (file: string) => AsyncIterable<Row>;

export function parseCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export async function* csvRows(input: Readable): AsyncIterable<Row> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of rl) {
    if (!raw) continue;
    if (!header) {
      header = parseCsvLine(raw.replace(/^﻿/, '')).map(h => h.trim());
      continue;
    }
    const c = parseCsvLine(raw);
    const o: Row = {};
    for (let i = 0; i < header.length; i++) o[header[i]!] = c[i] ?? '';
    yield o;
  }
}

/** GTFS files in a plain folder (used by tests with fixtures/gtfs-tml-sample). */
export function folderSource(dir: string): GtfsSource {
  return async function* (file) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return;
    yield* csvRows(fs.createReadStream(p));
  };
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) => yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (e, z) => (e ? rej(e) : res(z!))));
}

/** GTFS files read directly from a zip, file by file. */
export async function zipSource(zipPath: string): Promise<{ source: GtfsSource; files: string[]; close: () => void }> {
  const zip = await openZip(zipPath);
  const entries = new Map<string, yauzl.Entry>();
  await new Promise<void>((res, rej) => {
    zip.on('entry', (e: yauzl.Entry) => {
      entries.set(path.posix.basename(e.fileName), e);
      zip.readEntry();
    });
    zip.on('end', () => res());
    zip.on('error', rej);
    zip.readEntry();
  });
  const source: GtfsSource = async function* (file) {
    const e = entries.get(file);
    if (!e) return;
    const stream = await new Promise<Readable>((res, rej) => zip.openReadStream(e, (err, s) => (err ? rej(err) : res(s!))));
    yield* csvRows(stream);
  };
  return { source, files: [...entries.keys()], close: () => zip.close() };
}

/** Download `url` to `dest` unless a copy younger than `maxAgeH` exists. Returns size and whether it was fresh. */
export async function download(url: string, dest: string, maxAgeH = 12): Promise<{ bytes: number; reused: boolean }> {
  if (fs.existsSync(dest) && Date.now() - fs.statSync(dest).mtimeMs < maxAgeH * 3600_000) {
    return { bytes: fs.statSync(dest).size, reused: true };
  }
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'TPulso-timetable-build/0.1' } });
  if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) throw new Error(`${url} returned an HTML page, not a GTFS zip`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    Readable.fromWeb(res.body as never).pipe(out).on('finish', () => resolve()).on('error', reject);
  });
  fs.renameSync(tmp, dest);
  return { bytes: fs.statSync(dest).size, reused: false };
}
