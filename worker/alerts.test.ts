// Service alerts (docs/ALERTS.md): both sources tested on the real responses saved in fixtures/alerts/
// (2026-10-27 22:18 UTC), plus the combined provider and the /api/alerts route.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineIdOfRoute, type AlertList, type AlertSource, type ServiceAlert } from '../shared/alerts';
import { handleAlerts } from './index';
import { AlertSourceError } from './providers/alerts/fetchText';
import { AllSourcesFailed, CombinedAlerts } from './providers/alerts/provider';
import { parseTmlHub, TML_HUB_ALERTS_URL, TmlHubAlerts } from './providers/alerts/tmlHub';
import { decodeEntities, htmlToText, parseTtslRss, TTSL_RSS_URL, TtslRssAlerts } from './providers/alerts/ttslRss';

const FIX = path.resolve(__dirname, '../fixtures/alerts');
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const NOW = Date.parse(read('fetched-at.txt').trim());
const HUB = read('tml-hub-alerts.json');
const RSS = read('ttsl-avisos.rss.xml');

/** fetch replaced by the saved responses; `down` lists URLs that answer 503. */
function fixtureFetch(down: string[] = []) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    if (down.includes(url)) return new Response('', { status: 503 });
    if (url === TML_HUB_ALERTS_URL) return new Response(HUB);
    if (url === TTSL_RSS_URL) return new Response(RSS);
    return new Response('', { status: 404 });
  };
  return { fn, calls };
}

describe('lineIdOfRoute (approved 2026-10-28)', () => {
  it('drops the route variant number', () => {
    expect(lineIdOfRoute('[BNA17]2303_0')).toBe('[BNA17]2303');
    expect(lineIdOfRoute('[IA2N9]2_1')).toBe('[IA2N9]2');
    expect(lineIdOfRoute('[A2L1N]4501_12')).toBe('[A2L1N]4501');
  });
  it('gives no line id for route ids of another form (never guessed)', () => {
    expect(lineIdOfRoute('[HF16N]M25_A')).toBeNull(); // MobiCascais
    expect(lineIdOfRoute('[A3H3M]1_1-TERM')).toBeNull(); // TCB
    expect(lineIdOfRoute('3715')).toBeNull();
  });
});

describe('TML hub alerts', () => {
  const alerts = parseTmlHub(HUB, NOW);
  const byId = (id: string) => alerts.find(a => a.id === id)!;

  it('keeps every alert that has not ended (119 in the feed, 1 ended)', () => {
    expect(alerts).toHaveLength(118);
    expect(alerts.find(a => a.id === 'tml:ADMGP')).toBeUndefined(); // ended 21:59 UTC, before the capture
    expect(alerts.every(a => a.end === null || a.end > NOW)).toBe(true);
  });
  it('passes on line alerts by their line keys, with the affected stops when given', () => {
    expect(byId('tml:MZ33B')).toMatchObject({
      agencyId: 'IA2N9',
      scope: 'lines',
      lines: [{ lineId: '[IA2N9]2', stopIds: ['210443'] }],
      stops: [],
      title: 'Metro | Estação Entre Campos: Acesso encerrado',
      cause: 'CONSTRUCTION',
      effect: 'ACCESSIBILITY_ISSUE',
      endAssumed: false,
      url: 'https://www.metrolisboa.pt/',
    });
  });
  it('merges the repeated stop references of a stop alert', () => {
    const a = byId('tml:GZ1Q4');
    expect(a.scope).toBe('stops');
    expect(a.stops.map(s => s.stopId)).toEqual(['310135', '310136']);
    expect(a.stops[0]!.lineIds).toEqual(['[A2L1N]4501', '[A2L1N]4504', '[A2L1N]4512', '[A2L1N]4702', '[A2L1N]4708']);
    expect(a.effect).toBe('STOP_MOVED');
    expect(a.imageUrl).toMatch(/^https:\/\//);
  });
  it('rejects a response that is not the alerts list', () => {
    expect(() => parseTmlHub('<html>', NOW)).toThrow(AlertSourceError);
    expect(() => parseTmlHub('{"error":"x"}', NOW)).toThrow(AlertSourceError);
  });
  it('skips alerts without an id, agency or title, and keeps only https links', () => {
    const body = JSON.stringify({
      data: [
        { _id: 'A', agency_id: 'BNA17', title: 'ok', info_url: 'javascript:alert(1)', reference_type: 'agency', references: [] },
        { _id: 'B', agency_id: 'BNA17', title: '' },
        { agency_id: 'BNA17', title: 'no id' },
      ],
    });
    const out = parseTmlHub(body, NOW);
    expect(out.map(a => a.id)).toEqual(['tml:A']);
    expect(out[0]).toMatchObject({ scope: 'agency', url: null, start: null, end: null, cause: 'UNKNOWN_CAUSE' });
  });
});

describe('Transtejo / Soflusa notices (RSS)', () => {
  const notices = parseTtslRss(RSS, NOW);

  it('keeps the notices published in the last 30 days, operator-wide', () => {
    expect(notices).toHaveLength(5); // of 10 in the feed
    for (const n of notices) {
      expect(n).toMatchObject({ source: 'ttsl', agencyId: 'LTP61', scope: 'agency', lines: [], stops: [], endAssumed: true });
      expect(n.end! - n.start!).toBe(30 * 86_400_000);
    }
  });
  it('reads title, date, link and text, without HTML or empty paragraphs', () => {
    const n = notices[0]!;
    expect(n.title).toBe('Trafaria – Porto Brandão – Belém | 24 out.');
    expect(new Date(n.start!).toISOString()).toBe('2026-10-24T06:44:55.000Z');
    expect(n.url).toBe('https://ttsl.pt/avisos/trafaria-porto-brandao-belem-24-out/');
    expect(n.id).toBe('ttsl:https://ttsl.pt/?post_type=avisos&p=20949');
    expect(n.description.split('\n').slice(0, 3)).toEqual([
      'Serviço normalizado',
      'Interrupção temporária do serviço de transporte de veículos',
      'O serviço de transporte de veículos encontra-se restabelecido.',
    ]);
    expect(n.description).not.toMatch(/<|&nbsp;|\n\n/);
  });
  it('drops a notice once it is older than 30 days', () => {
    // 21 Nov: the 21 Oct notice (ends 20 Nov 08:58) is gone, the 24 Oct one (ends 23 Nov) stays.
    const later = parseTtslRss(RSS, Date.parse('2026-11-21T00:00:00Z'));
    expect(later.map(n => n.title)).toEqual(['Trafaria – Porto Brandão – Belém | 24 out.']);
  });
  it('decodes entities and flattens HTML', () => {
    expect(decodeEntities('a &#8211; b &#124; &amp;&nbsp;&#x41;')).toBe('a – b | & A');
    expect(htmlToText('<h2>A</h2><p>&nbsp;</p><p>B <b>c</b></p>')).toBe('A\nB c');
  });
  it('rejects a response that is not RSS', () => {
    expect(() => parseTtslRss('<html></html>', NOW)).toThrow(AlertSourceError);
  });
});

describe('combined provider and GET /api/alerts', () => {
  it('serves both sources, cached for 60 s', async () => {
    const f = fixtureFetch();
    const p = new CombinedAlerts([new TmlHubAlerts(f.fn), new TtslRssAlerts(f.fn)]);
    const res = await handleAlerts(p, new Date(NOW));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    const body = (await res.json()) as AlertList;
    expect(body.sources).toEqual([
      { id: 'tml', ok: true, count: 118 },
      { id: 'ttsl', ok: true, count: 5 },
    ]);
    expect(body.alerts).toHaveLength(123);
    await p.alerts(NOW + 59_000);
    expect(f.calls).toHaveLength(2); // second request served from memory
    await p.alerts(NOW + 61_000);
    expect(f.calls).toHaveLength(4);
  });
  it('gives a partial result when one source fails, and says which', async () => {
    const f = fixtureFetch([TTSL_RSS_URL]);
    const body = await new CombinedAlerts([new TmlHubAlerts(f.fn), new TtslRssAlerts(f.fn)]).alerts(NOW);
    expect(body.sources).toEqual([
      { id: 'tml', ok: true, count: 118 },
      { id: 'ttsl', ok: false, count: 0, error: 'upstream 503' },
    ]);
    expect(body.alerts.every(a => a.source === 'tml')).toBe(true);
  });
  it('answers 502 when every source fails (no empty list pretending all is well)', async () => {
    const f = fixtureFetch([TML_HUB_ALERTS_URL, TTSL_RSS_URL]);
    const p = new CombinedAlerts([new TmlHubAlerts(f.fn), new TtslRssAlerts(f.fn)]);
    await expect(p.alerts(NOW)).rejects.toThrow(AllSourcesFailed);
    const res = await handleAlerts(p, new Date(NOW + 1));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'alerts_unavailable' });
  });
  it('does not keep a total failure: the next request tries again', async () => {
    let up = false;
    const flaky: AlertSource = {
      id: 'tml',
      fetchAlerts: async () => {
        if (!up) throw new AlertSourceError('upstream 503');
        return [] as ServiceAlert[];
      },
    };
    const p = new CombinedAlerts([flaky]);
    await expect(p.alerts(NOW)).rejects.toThrow();
    up = true;
    expect((await p.alerts(NOW + 1000)).sources[0]!.ok).toBe(true);
  });
  it('is off unless ALERTS_ENABLED is "true", independent of the live flag', async () => {
    const worker = (await import('./index')).default;
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    for (const env of [{}, { ALERTS_ENABLED: 'false', LIVE_ENABLED: 'true' }]) {
      const res = await worker.fetch(new Request('http://x/api/alerts') as never, env, ctx);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'alerts_disabled' });
    }
    const post = await worker.fetch(new Request('http://x/api/alerts', { method: 'POST' }) as never, { ALERTS_ENABLED: 'true' }, ctx);
    expect(post.status).toBe(405);
  });
});
