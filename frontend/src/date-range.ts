/**
 * Start / end date pair used across the admin.
 *  - end can never be before start (picker greys those days out, and a stale end date is moved)
 *  - optional "future only" mode (new catalogue trips can't start in the past)
 *  - duration label (3D/2N) and day count are calculated automatically
 */

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Inclusive number of days: 12 Jun → 12 Jun = 1, 12 Jun → 14 Jun = 3. */
export function inclusiveDays(startIso: string, endIso: string): number {
  const a = parse(startIso);
  const b = parse(endIso);
  if (!a || !b || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** "3D/2N" (a single day is just "1D"). */
export function durationLabelFor(days: number): string {
  if (days < 1) return "";
  return days === 1 ? "1D" : `${days}D/${days - 1}N`;
}

/** "4 days / 3 nights" — friendlier wording for previews. */
export function durationWords(days: number): string {
  if (days < 1) return "";
  if (days === 1) return "1 day";
  return `${days} days / ${days - 1} nights`;
}

/** "18–21 June 2026", "28 June – 2 July 2026", "30 Dec 2026 – 2 Jan 2027". */
export function prettyRange(startIso: string, endIso: string): string {
  const a = parse(startIso);
  const b = parse(endIso || startIso);
  if (!a) return "";
  if (!b) return prettyDate(startIso);
  const month = (d: Date, long = true): string => d.toLocaleString("en-GB", { month: long ? "long" : "short" });
  if (a.getTime() === b.getTime()) return `${a.getDate()} ${month(a)} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${month(a)} ${a.getFullYear()}`;
    return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)} ${a.getFullYear()}`;
  }
  return `${a.getDate()} ${month(a, false)} ${a.getFullYear()} – ${b.getDate()} ${month(b, false)} ${b.getFullYear()}`;
}

export function prettyDate(iso: string): string {
  const d = parse(iso);
  return d ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
}

export type DateRangeInfo = {
  start: string;
  end: string;
  days: number;
  label: string;
  words: string;
  pretty: string;
  valid: boolean;
  message: string;
};

export type DateRangeOptions = {
  start: HTMLInputElement;
  end: HTMLInputElement;
  /** only allow today or later (new catalogue trips) */
  futureOnly?: boolean;
  /** input that receives the auto duration label (e.g. "3D/2N") */
  durationInput?: HTMLInputElement | null;
  /** begin with the duration left as-is (editing an existing trip) */
  startManual?: boolean;
  /** typing in the duration box switches auto-calculation off (default true) */
  manualOnType?: boolean;
  /** element that shows the live summary ("12 Jun → 14 Jun · 3 days / 2 nights") */
  summary?: HTMLElement | null;
  onChange?: (info: DateRangeInfo) => void;
};

export type DateRangeHandle = {
  info: () => DateRangeInfo;
  /** stop auto-filling the duration (admin typed their own); returns to auto with resetDuration() */
  resetDuration: () => void;
  setDurationManual: (manual: boolean) => void;
  isDurationManual: () => boolean;
};

export function wireDateRange(opts: DateRangeOptions): DateRangeHandle {
  const { start, end, durationInput, summary } = opts;
  let manualDuration = opts.startManual === true;

  const read = (): DateRangeInfo => {
    const s = start.value;
    const e = end.value;
    const days = s && e ? inclusiveDays(s, e) : 0;
    let message = "";
    let valid = false;
    if (!s) message = "Pick a start date first.";
    else if (opts.futureOnly && s < todayIso()) message = "Start date can't be in the past.";
    else if (!e) message = "Now pick the end date.";
    else if (e < s) message = "End date can't be before the start date.";
    else valid = true;
    return {
      start: s,
      end: e,
      days,
      label: durationLabelFor(days),
      words: durationWords(days),
      pretty: s && e && e >= s ? prettyRange(s, e) : "",
      valid,
      message,
    };
  };

  const render = (): void => {
    const info = read();
    if (summary) {
      summary.classList.toggle("is-valid", info.valid);
      summary.classList.toggle("is-warn", !info.valid && !!info.message && !!start.value);
      summary.innerHTML = info.valid
        ? `<span class="dr-ico" aria-hidden="true">📅</span><span><strong>${info.pretty}</strong><em>${info.words}</em></span>`
        : `<span class="dr-ico" aria-hidden="true">🗓️</span><span><em>${info.message}</em></span>`;
    }
    if (durationInput && !manualDuration) {
      durationInput.value = info.label;
      durationInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    opts.onChange?.(info);
  };

  const sync = (): void => {
    if (opts.futureOnly) start.min = todayIso();
    end.disabled = !start.value;
    end.min = start.value || (opts.futureOnly ? todayIso() : "");
    if (start.value && end.value && end.value < start.value) {
      end.value = start.value; // never leave an end date before the start
      end.classList.add("dr-bumped");
      window.setTimeout(() => end.classList.remove("dr-bumped"), 900);
    }
    render();
  };

  start.addEventListener("change", () => {
    sync();
    if (start.value && !end.value) {
      end.value = start.value;
      render();
      // jump straight to the end date, calendar opens on the right month
      try {
        end.focus();
        (end as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
      } catch {
        /* showPicker needs a user gesture in some browsers */
      }
    }
  });
  start.addEventListener("input", sync);
  end.addEventListener("change", sync);
  end.addEventListener("input", render);
  if (opts.manualOnType !== false) {
    durationInput?.addEventListener("input", (e) => {
      if ((e as InputEvent).isTrusted) manualDuration = true; // only real typing, not our own updates
    });
  }
  start.form?.addEventListener("reset", () => {
    manualDuration = false;
    window.setTimeout(sync, 0);
  });

  sync();
  return {
    info: read,
    resetDuration: () => {
      manualDuration = false;
      render();
    },
    setDurationManual: (manual: boolean) => {
      manualDuration = manual;
      if (!manual) render();
    },
    isDurationManual: () => manualDuration,
  };
}
