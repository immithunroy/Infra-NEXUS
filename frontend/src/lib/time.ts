// Time display helpers. All timestamps come from the API as ISO strings in
// UTC; they are rendered in Asia/Dhaka (or the configured timezone) regardless
// of the viewer's local zone.
let TZ = "Asia/Dhaka";

// Intl.DateTimeFormat instances (recreated when timezone changes)
let _full: Intl.DateTimeFormat | null = null;
let _short: Intl.DateTimeFormat | null = null;

function ensureFormatters(): { full: Intl.DateTimeFormat; short: Intl.DateTimeFormat } {
  if (!_full || !_short) {
    _full = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    _short = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return { full: _full, short: _short };
}

export function getTimezone(): string {
  return TZ;
}

export function setTimezone(tz: string): void {
  if (tz && tz !== TZ) {
    TZ = tz;
    _full = null;
    _short = null;
  }
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return ensureFormatters().full.format(d);
}

export function fmtTimeShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return ensureFormatters().short.format(d);
}

/** Format using a provided timezone (for Settings preview, etc.) */
export function fmtTimeInZone(iso: string | Date | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// Load timezone from API on module init
(async () => {
  try {
    const token = localStorage.getItem("token");
    if (token) {
      const res = await fetch("/api/settings/timezone/options", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // Read the actual saved timezone value
        const res2 = await fetch("/api/settings/timezone", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res2.ok) {
          const setting = await res2.json();
          if (setting.value) {
            setTimezone(setting.value);
          }
        }
      }
    }
  } catch {
    // Default to Asia/Dhaka
  }
})();
