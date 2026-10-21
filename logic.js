(function (root) {
  "use strict";

  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  function daysInMonth(year, month) {
    if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function parse(date) {
    const match = typeof date === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new RangeError("Use a date in YYYY-MM-DD format.");
    const [, y, m, d] = match;
    const year = Number(y), month = Number(m), day = Number(d);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      throw new RangeError("That calendar date does not exist.");
    }
    return { year, month, day };
  }

  function key(year, month, day) {
    if (year < 1 || year > 9999) throw new RangeError("Dates must be between years 0001 and 9999.");
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Gregorian civil-day arithmetic. No timestamps, timezone offsets, or date-string parsing.
  function ordinal(date) {
    let { year, month, day } = parse(date);
    year -= month <= 2 ? 1 : 0;
    const era = Math.floor(year / 400);
    const y = year - era * 400;
    const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    return era * 146097 + y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + dayOfYear - 719468;
  }

  function fromOrdinal(value) {
    const z = value + 719468;
    const era = Math.floor(z / 146097);
    const dayOfEra = z - era * 146097;
    const y = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
    let year = y + era * 400;
    const dayOfYear = dayOfEra - (365 * y + Math.floor(y / 4) - Math.floor(y / 100));
    const m = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * m + 2) / 5) + 1;
    const month = m + (m < 10 ? 3 : -9);
    year += month <= 2 ? 1 : 0;
    return key(year, month, day);
  }

  function addDays(date, count) {
    if (!Number.isInteger(count)) throw new RangeError("Day count must be an integer.");
    return fromOrdinal(ordinal(date) + count);
  }

  function addMonths(date, count) {
    if (!Number.isInteger(count)) throw new RangeError("Month count must be an integer.");
    const { year, month, day } = parse(date);
    const index = year * 12 + month - 1 + count;
    const y = Math.floor(index / 12), m = ((index % 12) + 12) % 12 + 1;
    return key(y, m, Math.min(day, daysInMonth(y, m)));
  }

  function weekday(date) {
    return ((ordinal(date) + 3) % 7 + 7) % 7;
  }

  function startOfWeek(date) {
    return addDays(date, -weekday(date));
  }

  function monthStart(date) {
    return `${date.slice(0, 7)}-01`;
  }

  function monthEnd(date) {
    const { year, month } = parse(date);
    return key(year, month, daysInMonth(year, month));
  }

  function today() {
    const now = new Date();
    return key(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function format(date, options = {}) {
    const { year, month, day } = parse(date);
    const name = options.short ? MONTHS[month - 1].slice(0, 3) : MONTHS[month - 1];
    return `${options.weekday ? `${WEEKDAYS[weekday(date)]}, ` : ""}${name} ${day}${options.year === false ? "" : `, ${year}`}`;
  }

  function monthLabel(date) {
    const { year, month } = parse(date);
    return `${MONTHS[month - 1]} ${year}`;
  }

  function calendarMonths(date, extraMonths = 0) {
    if (!Number.isInteger(extraMonths) || extraMonths < 0 || extraMonths % 3 !== 0) {
      throw new RangeError("Extra months must be a nonnegative multiple of three.");
    }
    const first = monthStart(addDays(date, -84));
    const last = monthStart(addMonths(monthStart(date), 12 + extraMonths));
    const months = [];
    for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month);
    return months;
  }

  function monthCells(month) {
    const first = startOfWeek(monthStart(month));
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }

  function initialState(date = today()) {
    return { version: 1, pattern: [0, 1, 2], overrides: {}, extraMonths: 0, asOf: date };
  }

  function isOffice(date, schedule) {
    const day = weekday(date);
    if (day > 4) return false;
    if (Object.hasOwn(schedule.overrides, date)) return schedule.overrides[date];
    return schedule.pattern.includes(day);
  }

  function weekSummary(date, schedule) {
    const start = startOfWeek(date);
    const days = Array.from({ length: 5 }, (_, index) => addDays(start, index));
    const officeDays = days.filter(day => isOffice(day, schedule)).length;
    return { start, end: addDays(start, 6), officeDays, qualifies: officeDays >= 3 };
  }

  function compliance(asOf, schedule) {
    const currentStart = startOfWeek(asOf);
    const weeks = Array.from({ length: 12 }, (_, index) =>
      weekSummary(addDays(currentStart, (index - 12) * 7), schedule));
    const count = weeks.filter(week => week.qualifies).length;
    const current = weekSummary(currentStart, schedule);
    const forecastCount = count - Number(weeks[0].qualifies) + Number(current.qualifies);
    return {
      weeks, count, compliant: count >= 8,
      start: weeks[0].start, end: weeks[11].end, current,
      forecastCount, forecastCompliant: forecastCount >= 8,
      forecastAsOf: addDays(currentStart, 7)
    };
  }

  function weekdaysBetween(start, end) {
    parse(start); parse(end);
    if (start > end) throw new RangeError("The end date must be on or after the start date.");
    const days = [];
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (weekday(day) < 5) days.push(day);
    }
    return days;
  }

  function paint(schedule, start, end, office) {
    if (typeof office !== "boolean") throw new TypeError("Choose Office or WFH.");
    const days = weekdaysBetween(start, end);
    for (const day of days) schedule.overrides[day] = office;
    return days.length;
  }

  function calendarCompliance(start, end, schedule) {
    parse(start); parse(end);
    if (start > end) throw new RangeError("The end date must be on or after the start date.");
    const windows = [];
    // Include the intersecting week itself, including the final displayed week.
    for (let weekStart = startOfWeek(start); weekStart <= end; weekStart = addDays(weekStart, 7)) {
      const asOf = addDays(weekStart, 7);
      const result = compliance(asOf, schedule);
      windows.push({ weekStart, asOf, start: result.start, end: result.end, count: result.count, compliant: result.compliant });
    }
    const failures = windows.filter(window => !window.compliant);
    const worst = windows.reduce((lowest, window) => window.count < lowest.count ? window : lowest);
    return { windows, failures, worst, firstFailure: failures[0] || null, compliant: failures.length === 0 };
  }

  function decodeState(raw) {
    const state = JSON.parse(raw);
    if (!state || state.version !== 1 || !Array.isArray(state.pattern) ||
        !state.pattern.every(day => Number.isInteger(day) && day >= 0 && day <= 4) ||
        new Set(state.pattern).size !== state.pattern.length ||
        !state.overrides || typeof state.overrides !== "object" || Array.isArray(state.overrides) ||
        !Number.isSafeInteger(state.extraMonths) || state.extraMonths < 0 || state.extraMonths % 3 !== 0) {
      throw new Error("Saved planner data has an unsupported format.");
    }
    parse(state.asOf);
    if (state.asOf < "1901-01-01" || state.asOf > "9998-10-01") throw new Error("Inspection date must be between 1901 and October 9998.");
    if (parse(addMonths(monthStart(today()), 12 + state.extraMonths)).year > 9998) {
      throw new Error("Calendar extension exceeds the supported date range.");
    }
    for (const [date, value] of Object.entries(state.overrides)) {
      parse(date);
      if (weekday(date) > 4 || typeof value !== "boolean") throw new Error("Saved day edits are invalid.");
    }
    return {
      version: 1, pattern: [...state.pattern], overrides: { ...state.overrides },
      extraMonths: state.extraMonths, asOf: state.asOf
    };
  }

  function encodePlan(state) {
    const plan = decodeState(JSON.stringify(state));
    return JSON.stringify({ format: "office-away-plan", version: 1, plan }, null, 2);
  }

  function decodePlan(raw) {
    const file = JSON.parse(raw);
    if (!file || file.format !== "office-away-plan" || file.version !== 1 ||
        Object.keys(file).some(field => !["format", "version", "plan"].includes(field))) {
      throw new Error("Choose an Office / Away JSON export with format office-away-plan and version 1.");
    }
    if (!file.plan || Object.keys(file.plan).some(field =>
      !["version", "pattern", "overrides", "extraMonths", "asOf"].includes(field))) {
      throw new Error("The plan contains missing or unsupported fields.");
    }
    return decodeState(JSON.stringify(file.plan));
  }

  const api = {
    WEEKDAYS, MONTHS, daysInMonth, parse, key, ordinal, fromOrdinal, addDays, addMonths,
    weekday, startOfWeek, monthStart, monthEnd, today, format, monthLabel,
    calendarMonths, monthCells, initialState, isOffice, weekSummary, compliance,
    weekdaysBetween, paint, calendarCompliance, decodeState, encodePlan, decodePlan
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RTO = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this);
