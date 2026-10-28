import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServiceAlert } from '../../shared/alerts';
import { parseTmlHub } from '../../worker/providers/alerts/tmlHub';
import { alertsHere, buildAlertIndex, effectLabel, isCurrent } from './alerts';

const base: Omit<ServiceAlert, 'id' | 'scope' | 'agencyId'> = {
  source: 'tml', lines: [], stops: [], title: 't', description: '', cause: 'OTHER_CAUSE', effect: 'DETOUR',
  start: 0, end: null, endAssumed: false, url: null, imageUrl: null,
};
const NOW = 1_000_000;
const lineAlert: ServiceAlert = { ...base, id: 'L', scope: 'lines', agencyId: 'BNA17', lines: [{ lineId: '[BNA17]2303', stopIds: [] }] };
const lineAtStop: ServiceAlert = { ...base, id: 'LS', scope: 'lines', agencyId: 'IA2N9', lines: [{ lineId: '[IA2N9]2', stopIds: ['210443'] }] };
const stopAlert: ServiceAlert = { ...base, id: 'S', scope: 'stops', agencyId: 'A2L1N', stops: [{ stopId: '310135', lineIds: ['[A2L1N]4501'] }] };
const stopAll: ServiceAlert = { ...base, id: 'SA', scope: 'stops', agencyId: 'A2L1N', stops: [{ stopId: '310136', lineIds: [] }] };
const notice: ServiceAlert = { ...base, id: 'N', scope: 'agency', agencyId: 'LTP61', source: 'ttsl', endAssumed: true, end: NOW + 1 };
const later: ServiceAlert = { ...lineAlert, id: 'LATER', start: NOW + 3600_000 };
const ended: ServiceAlert = { ...lineAlert, id: 'ENDED', end: NOW - 1 };
const mobi: ServiceAlert = { ...base, id: 'M', scope: 'lines', agencyId: 'HF16N', lines: [{ lineId: '[HF16N]25', stopIds: [] }] };
const ALL = [lineAlert, lineAtStop, stopAlert, stopAll, notice, later, ended, mobi];

describe('departure and vehicle alerts', () => {
  const idx = buildAlertIndex(ALL, NOW);
  it('a line alert marks every departure and vehicle of that line', () => {
    expect(idx.forDeparture('[BNA17]2303', '999')).toMatchObject({ kind: 'line', alerts: [lineAlert] });
    expect(idx.forLine('[BNA17]2303')).toEqual([lineAlert]);
    expect(idx.forDeparture('[BNA17]2304', '999')).toBeNull();
  });
  it('a line alert limited to some stops marks departures at those stops only, the vehicles of the line always', () => {
    expect(idx.forDeparture('[IA2N9]2', '210443')?.alerts).toEqual([lineAtStop]);
    expect(idx.forDeparture('[IA2N9]2', '210444')).toBeNull();
    expect(idx.forLine('[IA2N9]2')).toEqual([lineAtStop]);
  });
  it('a stop alert marks the named lines at that stop (or all lines when none are named), never vehicles', () => {
    expect(idx.forDeparture('[A2L1N]4501', '310135')).toMatchObject({ kind: 'stop', alerts: [stopAlert] });
    expect(idx.forDeparture('[A2L1N]4600', '310135')).toBeNull();
    expect(idx.forDeparture(undefined, '310136')).toMatchObject({ kind: 'stop', alerts: [stopAll] });
    expect(idx.forLine('[A2L1N]4501')).toEqual([]);
  });
  it('never links a departure without a line key to a line alert (no guessing)', () => {
    expect(idx.forDeparture(undefined, '999')).toBeNull();
    expect(idx.forLine(undefined)).toEqual([]);
  });
  it('ignores alerts that are announced for later or have ended', () => {
    expect(idx.forLine('[BNA17]2303').map((a) => a.id)).toEqual(['L']);
    expect(isCurrent(later, NOW)).toBe(false);
    expect(isCurrent(ended, NOW)).toBe(false);
  });
});

describe('alerts for the radar', () => {
  const agenciesOf = new Map([['cm', ['BNA17', 'A2L1N']], ['metro', ['IA2N9']], ['ttsl', ['LTP61']], ['mobicascais', ['HF16N']]]);
  it('lists alerts on lines and stops here, notices of operators here, and announced ones apart', () => {
    const r = alertsHere(ALL, {
      departures: [{ lineId: '[BNA17]2303', stopId: '1', op: 'cm' }, { lineId: '[A2L1N]4600', stopId: '310135', op: 'cm' }, { lineId: '[LTP61]1', stopId: '2', op: 'ttsl' }],
      vehicles: [{ lineId: '[IA2N9]2', op: 'metro' }],
      agenciesOf,
    }, NOW);
    expect(r.current.map((a) => a.id)).toEqual(['L', 'LS', 'S', 'N']); // notice last
    expect(r.announced.map((a) => a.id)).toEqual(['LATER']);
  });
  it('leaves out alerts of lines, stops and operators that are not here', () => {
    const r = alertsHere(ALL, { departures: [{ lineId: '[BNA17]9999', stopId: '1', op: 'cm' }], vehicles: [], agenciesOf }, NOW);
    expect(r.current).toEqual([]);
  });
  it('lists a line alert of an operator without line keys when that operator is here', () => {
    const r = alertsHere(ALL, { departures: [{ lineId: undefined, stopId: '7', op: 'mobicascais' }], vehicles: [], agenciesOf }, NOW);
    expect(r.current.map((a) => a.id)).toEqual(['M']);
  });
  it('works on the saved TML alerts: the Metro alert at Entre Campos concerns line Am (Amarela)', () => {
    const fix = fs.readFileSync(path.resolve(__dirname, '../../fixtures/alerts/tml-hub-alerts.json'), 'utf8');
    const now = Date.parse('2026-10-27T22:18:21Z');
    const real = parseTmlHub(fix, now);
    const r = alertsHere(real, { departures: [], vehicles: [{ lineId: '[IA2N9]2', op: 'metro' }], agenciesOf }, now);
    expect(r.current.map((a) => a.title)).toEqual(['Metro | Estação Entre Campos: Acesso encerrado']);
    expect(effectLabel(r.current[0]!.effect)).toBe('Accessibility');
  });
});
