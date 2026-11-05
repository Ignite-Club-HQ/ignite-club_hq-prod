/**
 * iCalendar (.ics) export utilities.
 * Generates RFC 5545 compatible files that work with Google Calendar,
 * Outlook, Apple Calendar and any other standards-compliant client.
 */
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { AppLauncher } from "@capacitor/app-launcher";

export interface IcsEventInput {
  id: string;
  title: string;
  type?: string | null;
  event_date: string; // ISO date or full ISO datetime
  start_time?: string | null; // "HH:MM" or "HH:MM:SS"
  end_time?: string | null;   // "HH:MM" or "HH:MM:SS"
  description?: string | null;
  location_name?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  is_cancelled?: boolean | null;
  updated_at?: string | null;
  url?: string | null; // public link to event
  time_zone?: string | null;
}

export type CalendarSource = IcsEventInput & {
  timezone?: string | null;
  clubs?: { name?: string; time_zone?: string | null; timezone?: string | null } | null;
};

export const CALENDAR_EXPORT_HELP = "Couldn't open or share the calendar file. Use Add to Google Calendar for a single event, or add events manually in your calendar using the times shown in Ignite.";

/** One mapping for event details and every schedule export. No hostname-dependent links. */
export function mapEventToCalendar(event: CalendarSource): IcsEventInput {
  const { clubs, timezone, ...fields } = event;
  return { ...fields, time_zone: clubs?.time_zone || clubs?.timezone || event.time_zone || timezone || "Australia/Adelaide", url: calendarEventUrl(event.id) };
}

function calendarEventUrl(id: string): string {
  return `https://igniteclubhq.app/events/${encodeURIComponent(id)}`;
}

export function calendarExportError(error: unknown): string {
  return error instanceof Error && error.message !== CALENDAR_EXPORT_HELP ? `${error.message} ${CALENDAR_EXPORT_HELP}` : CALENDAR_EXPORT_HELP;
}

const PRODID = "-//Ignite Club//Schedule Export//EN";
const CRLF = "\r\n";

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Convert a JS Date to a UTC ICS timestamp (YYYYMMDDTHHmmssZ). */
function toIcsUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Build a Date from a YYYY-MM-DD (or ISO) date plus an optional HH:MM[:SS]. */
function combineDateAndTime(eventDate: string, time: string | null | undefined, timeZone: string): Date {
  // ICP timestamps already identify an instant; don't reinterpret them as club wall time.
  if (!time && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(eventDate)) {
    const instant = new Date(eventDate);
    if (!Number.isFinite(instant.getTime())) throw new Error("Invalid event date.");
    return instant;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate.split("T")[0]);
  const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time || eventDate.split("T")[1]?.replace(/\.\d+$/, "") || "00:00");
  if (!match || !clock) throw new Error("Invalid event date or time.");
  const [year, month, day] = match.slice(1).map(Number);
  const [hour, minute, second] = [Number(clock[1]), Number(clock[2]), Number(clock[3] || 0)];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error("Invalid event date or time.");
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    if (observed === wall) return new Date(instant);
    instant += wall - observed;
  }
  throw new Error("This event time does not exist in the club's time zone.");
}

function eventTimes(e: IcsEventInput): { start: Date; end: Date } {
  const zone = e.time_zone || "Australia/Adelaide";
  const start = combineDateAndTime(e.event_date, e.start_time, zone);
  if (!e.end_time) return { start, end: new Date(start.getTime() + 3600000) };
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(e.end_time)) {
    const end = combineDateAndTime(e.end_time, null, zone);
    if (end <= start) throw new Error("Event end time must be after its start.");
    return { start, end };
  }
  // Derive the club's calendar date even when event_date is a UTC timestamp.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(start);
  const date = Object.fromEntries(parts.map(p => [p.type, p.value]));
  let day = `${date.year}-${date.month}-${date.day}`;
  let end = combineDateAndTime(day, e.end_time, zone);
  if (end <= start) {
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    end = combineDateAndTime(day, e.end_time, zone);
  }
  return { start, end };
}

/** Escape text per RFC 5545 §3.3.11 (TEXT). */
function escapeIcsText(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold long lines at 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      chunks.push(chunk);
      chunk = " ";
      bytes = 1;
    }
    chunk += character;
    bytes += size;
  }
  chunks.push(chunk);
  return chunks.join(CRLF);
}

function buildLocation(e: IcsEventInput): string | null {
  const parts = [
    e.location_name,
    e.address,
    [e.suburb, e.state, e.postcode].filter(Boolean).join(" "),
  ]
    .map((p) => (p ? String(p).trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function eventToVEvent(e: IcsEventInput): string {
  const { start, end } = eventTimes(e);
  const url = calendarEventUrl(e.id);
  const dtStamp = toIcsUtc(new Date());
  const lastModified = e.updated_at ? toIcsUtc(new Date(e.updated_at)) : dtStamp;

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${e.id}@ignite.invalid`,
    `DTSTAMP:${dtStamp}`,
    `LAST-MODIFIED:${lastModified}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(e.title || "Event")}`,
  ];

  const location = buildLocation(e);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  const descParts: string[] = [];
  if (e.description) descParts.push(e.description);
  descParts.push(`View in Ignite: ${url}`);
  if (descParts.length) {
    lines.push(`DESCRIPTION:${escapeIcsText(descParts.join("\n\n"))}`);
  }
  lines.push(`URL:${url}`);

  if (e.type) lines.push(`CATEGORIES:${escapeIcsText(e.type)}`);
  if (e.is_cancelled) lines.push("STATUS:CANCELLED");

  lines.push("END:VEVENT");
  return lines.map(foldLine).join(CRLF);
}

/** Build a complete .ics document for one or many events. */
export function buildIcs(events: IcsEventInput[], calendarName = "Ignite Schedule"): string {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]
    .map(foldLine)
    .join(CRLF);
  const body = events.map(eventToVEvent).join(CRLF);
  return [header, body, "END:VCALENDAR"].join(CRLF) + CRLF;
}

/** Sanitise a string for use as a filename. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
}

/**
 * Trigger download / share of an .ics file.
 * - Web: triggers a normal browser download.
 * - Native: cache → OS calendar opener → share sheet, with explicit failure.
 */
export async function downloadIcs(filenameBase: string, ics: string): Promise<void> {
  const filename = `${sanitiseFilename(filenameBase)}.ics`;

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await Filesystem.writeFile({
        path: filename,
        data: ics,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      if (!res.uri) throw new Error("Calendar file could not be saved.");
      try {
        await FileOpener.open({ filePath: res.uri, contentType: "text/calendar", openWithDefault: true });
      } catch {
        await Share.share({ title: filenameBase, files: [res.uri], dialogTitle: "Add to Calendar" });
      }
      return;
    } catch {
      throw new Error(CALENDAR_EXPORT_HELP);
    }
  }

  // Detect sandboxed iframe (e.g. Lovable preview) where downloads + popups are blocked.
  const inSandboxedIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  // In a sandboxed preview, skip the (silently failing) download and surface
  // the .ics content via a global event so a UI fallback dialog can show it.
  if (inSandboxedIframe) {
    const dataUrl = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    window.dispatchEvent(
      new CustomEvent("ics-preview-fallback", {
        detail: { filename, ics, dataUrl },
      }),
    );
    return;
  }

  // Web fallback: blob download.
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Defer revoke so the browser has time to start the download, even on error.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function buildGoogleCalendarUrl(event: IcsEventInput): string {
  const { start, end } = eventTimes(event);
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.title || "Event", dates: `${toIcsUtc(start)}/${toIcsUtc(end)}`, location: buildLocation(event) || "", details: [event.description, `View in Ignite: ${calendarEventUrl(event.id)}`].filter(Boolean).join("\n\n") });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export async function addToGoogleCalendar(event: IcsEventInput): Promise<void> {
  const url = buildGoogleCalendarUrl(event);
  if (Capacitor.isNativePlatform()) {
    const result = await AppLauncher.openUrl({ url });
    if (!result.completed) throw new Error("Google Calendar couldn't open.");
  } else {
    const tab = window.open("about:blank", "_blank");
    if (!tab) throw new Error("Allow pop-ups to open Google Calendar, or add the event manually.");
    tab.opener = null;
    tab.location.href = url;
  }
}

/** Convenience: build + download for a single event. */
export async function exportEventIcs(event: IcsEventInput): Promise<void> {
  const ics = buildIcs([event], event.title || "Event");
  await downloadIcs(event.title || "event", ics);
}

/** Convenience: build + download for a collection of events. */
export async function exportEventsIcs(
  events: IcsEventInput[],
  calendarName = "Ignite Schedule",
  filenameBase = "ignite-schedule",
): Promise<void> {
  const ics = buildIcs(events, calendarName);
  await downloadIcs(filenameBase, ics);
}
