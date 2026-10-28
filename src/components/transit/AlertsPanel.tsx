// TPulso: service alerts on screen (docs/ALERTS.md, phase 3): the list panel, the note on a departure row and the
// box in the vehicle panel. Amber, always with the warning icon and words (never colour alone).
import { useState } from "react";
import { ArrowLeft, ExternalLink, TriangleAlert } from "lucide-react";
import type { AlertSourceId, AlertSourceStatus, ServiceAlert } from "../../../shared/alerts";
import { effectLabel } from "@/offline/alerts";

/** One alert as the panel shows it: names resolved by key in App (never ids). */
export interface AlertCard {
  alert: ServiceAlert;
  /** Operator name, or "Operator" when the agency is not in the timetable. */
  operator: string;
  /** What it concerns: "Line Am · 1 stop", "Stop: Marquês de Pombal", "Whole operator"… */
  affected: string;
}

export interface AlertsView {
  status: "loading" | "ok" | "error";
  /** In force now / announced for later, concerning the radar. */
  current: AlertCard[];
  announced: AlertCard[];
  sources: AlertSourceStatus[];
  receivedAt: number | null;
}

const SOURCE_NAME: Record<AlertSourceId, string> = { tml: "TML", ttsl: "ttsl.pt" };
const SOURCE_FULL: Record<AlertSourceId, string> = { tml: "TML (all operators)", ttsl: "Transtejo / Soflusa notices" };

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", day: "numeric", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", day: "numeric", month: "short", year: "numeric" });
const yearOf = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", year: "numeric" }).format(ms);
function day(ms: number, now: number) {
  return yearOf(ms) === yearOf(now) ? dayFmt.format(ms) : dayYearFmt.format(ms);
}

/** "until 21 Dec", "from 31 Oct", "published 24 Oct" (validity not stated), "until further notice". */
export function validityText(a: ServiceAlert, now: number): string {
  if (a.endAssumed) return a.start !== null ? `published ${day(a.start, now)}` : "date not stated";
  if (a.start !== null && a.start > now) return `from ${day(a.start, now)}${a.end !== null ? ` until ${day(a.end, now)}` : ""}`;
  return a.end !== null ? `until ${day(a.end, now)}` : "until further notice";
}

export function agoText(ms: number, now: number) {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Amber note under a departure: "Line alert · Metro de Lisboa". Tapping it opens the alert list. */
export function AlertNote({ label, onOpen }: { label: string; onOpen?: (() => void) | undefined }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      className="alert-text flex items-center gap-1 text-[10px] font-semibold"
    >
      <TriangleAlert className="size-2.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** In the vehicle panel: the alerts on this vehicle's line. */
export function VehicleAlerts({ alerts, onOpen }: { alerts: ServiceAlert[]; onOpen?: (() => void) | undefined }) {
  if (!alerts.length) return null;
  return (
    <button type="button" onClick={onOpen} className="alert-box mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-xl px-3 py-2 text-left text-[11px]">
      <span className="flex items-center gap-1.5 font-display text-xs font-bold">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> Service alert on this line{alerts.length > 1 ? ` · ${alerts.length}` : ""}
      </span>
      {alerts.slice(0, 2).map((a) => (
        <span key={a.id} className="mt-0.5 block truncate">{a.title}</span>
      ))}
      <span className="mt-0.5 block font-semibold underline-offset-2">All alerts here →</span>
    </button>
  );
}

export function AlertsPanel({ view, now, onClose }: { view: AlertsView; now: number; onClose: (() => void) | undefined }) {
  const failed = view.sources.filter((s) => !s.ok);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button onClick={onClose} aria-label="Back to results" className="grid size-7 place-items-center rounded-lg bg-surface-2 text-foreground/80 active:scale-95">
          <ArrowLeft className="size-3.5" />
        </button>
        <TriangleAlert className="alert-text size-4" aria-hidden />
        <h2 className="font-display text-sm font-bold">Service alerts · {view.current.length}</h2>
      </div>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3 text-xs [-webkit-overflow-scrolling:touch]">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Alerts published by the operators for the lines, stops and operators in your radar (in Portuguese, as published). The times on
          this screen are still the timetable: they do not include these changes.
        </p>
        {view.status === "error" && !view.receivedAt && (
          <p className="mt-3 text-destructive">Service alerts could not be loaded (no connection?). Timetable data still works offline.</p>
        )}
        {view.status === "loading" && !view.receivedAt && <p className="mt-3 text-muted-foreground">Loading alerts…</p>}
        {view.receivedAt !== null && (
          <>
            {view.status === "error" && (
              <p className="mt-2 text-destructive">Could not refresh — showing alerts from {agoText(view.receivedAt, now)}.</p>
            )}
            {failed.map((s) => (
              <p key={s.id} className="mt-2 text-destructive">
                {SOURCE_FULL[s.id]} could not be loaded right now; they may be missing here.
              </p>
            ))}
            <h3 className="mt-4 mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">In force · {view.current.length}</h3>
            {view.current.length === 0 && <p className="text-muted-foreground">No alerts for the lines, stops and operators in your radar.</p>}
            <ul className="space-y-2.5">
              {view.current.map((c) => (
                <AlertItem key={c.alert.id} c={c} now={now} receivedAt={view.receivedAt!} />
              ))}
            </ul>
            {view.announced.length > 0 && (
              <>
                <h3 className="mt-5 mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Announced · {view.announced.length}</h3>
                <ul className="space-y-2.5 opacity-80">
                  {view.announced.map((c) => (
                    <AlertItem key={c.alert.id} c={c} now={now} receivedAt={view.receivedAt!} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AlertItem({ c, now, receivedAt }: { c: AlertCard; now: number; receivedAt: number }) {
  const [open, setOpen] = useState(false);
  const a = c.alert;
  const effect = effectLabel(a.effect);
  return (
    <li className="alert-item py-1 pl-2.5 pr-1">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="block w-full text-left">
        <span className="block font-display text-[13px] font-bold leading-snug [overflow-wrap:anywhere]">{a.title}</span>
        <span className="block text-[11px] text-foreground/80">
          {[effect, c.affected].filter(Boolean).join(" · ")}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {c.operator} · {validityText(a, now)}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {a.description && <p className="whitespace-pre-line text-[11px] leading-snug text-foreground/85">{a.description}</p>}
          {a.url && (
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
              More on the operator’s site <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
      <span className="block text-[10px] text-muted-foreground">
        {SOURCE_NAME[a.source]} · updated {agoText(receivedAt, now)}
        {!open && a.description ? " · tap for details" : ""}
      </span>
    </li>
  );
}
