// Transtejo / Soflusa notices (docs/ALERTS.md §4): the official WordPress RSS feed. It names no line or stop, so
// each notice is operator-wide (agency LTP61). It gives no validity period: a notice is shown for 30 days after
// publication, and disappears earlier when the operator removes it from the feed (the feed is read afresh).
import type { AlertSource, ServiceAlert } from '../../../shared/alerts';
import { AlertSourceError, fetchText, httpsUrl, type FetchFn } from './fetchText';

export const TTSL_RSS_URL = 'https://ttsl.pt/avisos/feed/';
export const TTSL_AGENCY_ID = 'LTP61';
export const NOTICE_DAYS = 30;
const MAX_TEXT = 4000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of one element of an item (CDATA unwrapped, entities decoded), or ''. */
function tag(item: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(item);
  if (!m) return '';
  const raw = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw);
  return cdata ? cdata[1]! : decodeEntities(raw);
}

/** Plain text from the notice's HTML: one line per paragraph, empty paragraphs dropped. */
export function htmlToText(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
  return text
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function parseTtslRss(xml: string, nowMs: number): ServiceAlert[] {
  if (!/<rss\b/.test(xml)) throw new AlertSourceError('not an RSS feed');
  const out: ServiceAlert[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const item = m[1]!;
    const title = tag(item, 'title').replace(/\s+/g, ' ').trim();
    const published = Date.parse(tag(item, 'pubDate'));
    const guid = tag(item, 'guid') || tag(item, 'link');
    if (!title || !Number.isFinite(published) || !guid) continue;
    const end = published + NOTICE_DAYS * 86_400_000;
    if (end <= nowMs) continue;
    const summary = htmlToText(tag(item, 'description'));
    const body = htmlToText(tag(item, 'content:encoded'));
    const description = (body.startsWith(summary) ? body : [summary, body].filter(Boolean).join('\n')).slice(0, MAX_TEXT);
    out.push({
      id: `ttsl:${guid}`,
      source: 'ttsl',
      agencyId: TTSL_AGENCY_ID,
      scope: 'agency',
      lines: [],
      stops: [],
      title,
      description,
      cause: 'UNKNOWN_CAUSE',
      effect: 'UNKNOWN_EFFECT',
      start: published,
      end,
      endAssumed: true,
      url: httpsUrl(tag(item, 'link')),
      imageUrl: null,
    });
  }
  return out;
}

export class TtslRssAlerts implements AlertSource {
  readonly id = 'ttsl' as const;
  private readonly fetchFn: FetchFn;
  constructor(fetchFn: FetchFn = (u, i) => fetch(u, i)) {
    this.fetchFn = fetchFn;
  }
  async fetchAlerts(nowMs: number): Promise<ServiceAlert[]> {
    return parseTtslRss(await fetchText(this.fetchFn, TTSL_RSS_URL, 300), nowMs);
  }
}
