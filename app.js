(function () {
  "use strict";
  const R = window.RTO;
  const TODAY = R.today();
  const STORAGE_KEY = "office-away-planner-v1";
  const $ = id => document.getElementById(id);
  let state = R.initialState(TODAY);
  let storageError = "";
  let undoStack = [];
  let globalResult = null;
  let pendingImport = null;
  let toastTimer;
  let drag = null;
  let suppressClick = false;
  let compact = false;
  let scrollScheduled = false;
  let dayButtons = new Map();
  let weekButtons = [];
  let months = [];
  let displayedToday = TODAY;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = R.decodeState(saved);
  } catch (error) {
    storageError = `Saved data could not be loaded (${error.message}). Showing the Mon/Tue/Wed default instead. Editing will replace an unreadable saved plan; if browser storage is blocked, changes last only until this page is closed.`;
  }

  function notify(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 4200);
  }

  function renderStorage() {
    $("storage-error").hidden = !storageError;
    $("storage-error").textContent = storageError;
    $("save-status").textContent = storageError ? "Not saved - see warning" : "Saved on this device";
    $("save-status").classList.toggle("unsaved", Boolean(storageError));
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageError = "";
    } catch (error) {
      storageError = `Your changes are not saved (${error.message}). The planner still works in this tab, but changes may be lost on reload. Enable browser storage or keep this tab open.`;
    }
    renderStorage();
  }

  function snapshot() {
    return { pattern: [...state.pattern], overrides: { ...state.overrides } };
  }

  function pushUndo(previous) {
    undoStack.push(previous);
    if (undoStack.length > 30) undoStack.shift();
    $("undo").disabled = false;
  }

  function patternText() {
    return state.pattern.length ? `${[...state.pattern].sort((a, b) => a - b).map(day => R.WEEKDAYS[day].slice(0, 3)).join(", ")} in office` : "all weekdays WFH";
  }

  function setInspection(date, announce = true) {
    if (date < $("as-of").min || date > $("as-of").max) {
      notify("Choose an inspection date within the displayed calendar, or use Add Months to plan further.");
      $("as-of").value = state.asOf;
      return;
    }
    R.parse(date);
    state.asOf = date;
    $("as-of").value = date;
    refresh();
    save();
    if (announce) notify(`Inspecting ${R.format(date, { short: true })}. Completed weeks exclude this week.`);
  }

  function renderDashboard(result) {
    const { compliant, worst, failures, firstFailure, windows } = globalResult;
    $("dashboard").classList.toggle("has-failures", !compliant);
    $("compliance-status").textContent = compliant ? "Compliant" : "Not compliant";
    $("compliance-status").classList.toggle("is-failing", !compliant);
    $("compliance-detail").textContent = compliant
      ? `All ${windows.length} visible week-ending windows pass`
      : `${failures.length} visible week-ending windows fail`;
    $("compliance-count").textContent = worst.count;
    $("window-label").textContent = `Worst: ${R.format(worst.start, { short: true })} - ${R.format(worst.end, { short: true })}`;
    $("failure-count").textContent = failures.length;
    $("global-first").textContent = firstFailure
      ? `First: week ending ${R.format(firstFailure.end, { short: true })}` : "No failures in the displayed range";
    $("show-first-failure").disabled = !firstFailure;
    $("inspection-status").textContent = `${result.count}/12 - ${result.compliant ? "compliant" : "not compliant"} for this inspected date only`;
    $("inspection-status").classList.toggle("is-failing", !result.compliant);
    $("pattern-summary").textContent = patternText();
    $("override-count").textContent = `${Object.keys(state.overrides).length} explicitly edited weekdays override this pattern.`;
    $("week-breakdown").innerHTML = result.weeks.map((week, index) => `
      <div class="week-tile${week.qualifies ? "" : " nonqualifying"}">
        <span>${R.format(week.start, { short: true, year: false })} - ${R.format(week.end, { short: true, year: false })}</span>
        <strong>${week.officeDays} / 5</strong><span>${week.qualifies ? "Qualifying" : "Does not qualify"}</span>
        ${index === 0 ? "<small>Drops out next week</small>" : "<small>Completed week</small>"}
      </div>`).join("");
    $("breakdown-note").textContent = `Selected week: ${R.format(result.current.start, { short: true })} through ${R.format(result.current.end, { short: true })} - ${result.current.officeDays}/5 planned office days. Not included in this inspected completed-week result. Including this week gives ${result.forecastCount}/12 (${result.forecastCompliant ? "compliant" : "not compliant"}) as of ${R.format(result.forecastAsOf, { short: true })}. The main dashboard always checks the entire displayed calendar, regardless of this date.`;
  }

  function updateDay(button, date, result) {
    const weekend = R.weekday(date) > 4;
    const office = R.isOffice(date, state);
    const edited = Object.hasOwn(state.overrides, date);
    button.classList.toggle("office", !weekend && office);
    button.classList.toggle("remote", !weekend && !office);
    button.classList.toggle("edited", edited);
    button.classList.toggle("in-window", date >= result.start && date <= result.end);
    button.classList.toggle("is-today", date === displayedToday);
    button.classList.toggle("is-as-of", date === state.asOf);
    if (date === displayedToday) button.setAttribute("aria-current", "date");
    else button.removeAttribute("aria-current");
    if (!weekend) {
      button.setAttribute("aria-pressed", String(office));
      button.querySelector(".day-kind").textContent = office ? "Office" : "WFH";
    }
    const label = `${R.format(date, { weekday: true })}. ${weekend ? "Weekend; not counted." : `${office ? "In office" : "Work from home"}. ${edited ? "Edited" : "Assumed from default pattern"}. Press to toggle.`}${date === displayedToday ? " Today." : ""}${date >= result.start && date <= result.end ? " In selected 12-week window." : ""}`;
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  function refresh() {
    const result = R.compliance(state.asOf, state);
    globalResult = R.calendarCompliance(months[0], R.monthEnd(months.at(-1)), state);
    renderDashboard(result);
    const windows = new Map(globalResult.windows.map(window => [window.weekStart, window]));
    for (const [date, button] of dayButtons) updateDay(button, date, result);
    for (const button of weekButtons) {
      const week = R.weekSummary(button.dataset.week, state);
      const after = R.addDays(week.start, 7);
      const rolling = R.compliance(after, state);
      const failing = windows.has(week.start) && !rolling.compliant;
      button.textContent = `${week.officeDays}/5`;
      button.classList.toggle("nonqualifying", !week.qualifies);
      button.classList.toggle("rolling-failure", failing);
      button.parentElement.classList.toggle("rolling-failure", failing);
      button.parentElement.classList.toggle("selected-week", week.start === result.current.start);
      button.setAttribute("aria-label", `Week of ${R.format(week.start)}: ${week.officeDays} office weekdays; ${week.qualifies ? "qualifying" : "not qualifying"}. Rolling result after this week: ${rolling.count} of 12, ${rolling.compliant ? "compliant" : "not compliant"}. Inspect as of ${R.format(after)}.`);
      button.title = button.getAttribute("aria-label");
    }
    document.querySelectorAll('input[name="pattern"]').forEach(input => {
      input.checked = state.pattern.includes(Number(input.value));
    });
    syncStickySize();
  }

  function renderMonths(append = false) {
    const allMonths = R.calendarMonths(displayedToday, state.extraMonths);
    const toRender = append ? allMonths.slice(months.length) : allMonths;
    if (!append) {
      $("months").replaceChildren();
      dayButtons = new Map();
      weekButtons = [];
    }
    const fragment = document.createDocumentFragment();
    for (const month of toRender) {
      const { year, month: number } = R.parse(month);
      const card = document.createElement("article");
      card.className = "month-card";
      card.id = `month-${month.slice(0, 7)}`;
      card.setAttribute("aria-label", R.monthLabel(month));
      const current = month.slice(0, 7) === displayedToday.slice(0, 7);
      const past = month < R.monthStart(displayedToday);
      card.innerHTML = `<header class="month-header"><h3>${R.MONTHS[number - 1]} <span class="month-year">${year}</span></h3><span class="month-tag${current ? " current" : ""}">${current ? "THIS MONTH" : past ? "PAST / ASSUMED" : "PLANNING AHEAD"}</span></header>
        <div class="weekday-labels" aria-hidden="true">${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(day => `<span>${day}</span>`).join("")}<span class="week-total-label">WK</span></div>`;
      const cells = R.monthCells(month);
      for (let row = 0; row < 6; row++) {
        const days = cells.slice(row * 7, row * 7 + 7);
        const week = document.createElement("div");
        const hasMonthDay = days.some(date => date.slice(0, 7) === month.slice(0, 7));
        week.className = `calendar-week${hasMonthDay ? "" : " empty-row"}`;
        for (const date of days) {
          const inMonth = date.slice(0, 7) === month.slice(0, 7);
          const weekend = R.weekday(date) > 4;
          if (inMonth) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `day${weekend ? " weekend" : ""}`;
            button.dataset.date = date;
            button.disabled = weekend;
            button.innerHTML = `<span class="day-number">${R.parse(date).day}</span>${weekend ? "" : '<span class="day-kind"></span>'}`;
            week.append(button);
            dayButtons.set(date, button);
          } else {
            const spillover = document.createElement("span");
            spillover.className = "spillover";
            spillover.setAttribute("aria-hidden", "true");
            spillover.textContent = R.parse(date).day;
            week.append(spillover);
          }
        }
        const total = document.createElement("button");
        total.type = "button";
        total.className = "week-total";
        total.dataset.week = days[0];
        total.disabled = !hasMonthDay;
        if (!hasMonthDay) total.setAttribute("aria-hidden", "true");
        weekButtons.push(total);
        week.append(total);
        card.append(week);
      }
      fragment.append(card);
    }
    $("months").append(fragment);
    months = allMonths;
    const first = months[0], last = months.at(-1);
    $("calendar-range").textContent = `${R.monthLabel(first)} - ${R.monthLabel(last)} / ${months.length} whole months`;
    $("range-end-note").textContent = `Planning through ${R.monthLabel(last)}. Keep going whenever you need.`;
    $("as-of").min = first;
    $("as-of").max = R.addDays(R.monthEnd(last), 7);
    refresh();
  }

  function scheduleChanged(previous, message) {
    pushUndo(previous);
    refresh();
    save();
    notify(message);
  }

  function changeDay(date) {
    const previous = snapshot();
    state.overrides[date] = !R.isOffice(date, state);
    scheduleChanged(previous, `${R.format(date, { short: true })} set to ${state.overrides[date] ? "Office" : "WFH"}.`);
  }

  function beginDrag(event) {
    const button = event.target.closest(".day:not(:disabled)");
    if (!button || event.pointerType !== "mouse" || event.button !== 0) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    drag = { previous: snapshot(), office: !R.isOffice(button.dataset.date, state), dates: new Set(), pointerId: event.pointerId };
    button.setPointerCapture(event.pointerId);
    paintDragDay(button);
  }

  function paintDragDay(button) {
    const date = button.dataset.date;
    if (drag.dates.has(date)) return;
    drag.dates.add(date);
    state.overrides[date] = drag.office;
    refresh();
  }

  function finishDrag(cancelled = false) {
    if (!drag) return;
    const finished = drag;
    drag = null;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (cancelled) {
      state.pattern = finished.previous.pattern;
      state.overrides = finished.previous.overrides;
      refresh();
      return;
    }
    const dates = [...finished.dates].sort();
    scheduleChanged(finished.previous, `${dates.length} ${dates.length === 1 ? "weekday" : "weekdays"} set to ${finished.office ? "Office" : "WFH"}.`);
  }

  $("months").addEventListener("pointerdown", beginDrag);
  document.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const button = document.elementFromPoint(event.clientX, event.clientY)?.closest(".day:not(:disabled)");
    if (button) paintDragDay(button);
  });
  document.addEventListener("pointerup", event => {
    if (drag && event.pointerId === drag.pointerId) finishDrag();
  });
  document.addEventListener("pointercancel", () => finishDrag(true));
  window.addEventListener("blur", () => finishDrag(true));
  $("months").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || suppressClick) return;
    if (button.dataset.week) {
      setInspection(R.addDays(button.dataset.week, 7));
      $("breakdown").open = true;
    }
    else if (button.dataset.date) changeDay(button.dataset.date);
  });
  $("months").addEventListener("keydown", event => {
    const button = event.target.closest(".day:not(:disabled)");
    const increments = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!button || !Object.hasOwn(increments, event.key)) return;
    event.preventDefault();
    const increment = increments[event.key];
    let date = R.addDays(button.dataset.date, increment);
    while (R.weekday(date) > 4) date = R.addDays(date, increment > 0 ? 1 : -1);
    dayButtons.get(date)?.focus();
  });

  $("as-of").value = state.asOf;
  $("as-of").addEventListener("change", () => {
    if ($("as-of").checkValidity()) setInspection($("as-of").value);
    else {
      $("as-of").reportValidity();
      $("as-of").value = state.asOf;
    }
  });
  $("as-of-today").addEventListener("click", () => setInspection(R.today()));
  $("jump-today").addEventListener("click", () => {
    setInspection(R.today(), false);
    const button = dayButtons.get(R.today());
    if (button) {
      button.scrollIntoView({ block: "center", behavior: "smooth" });
      button.focus({ preventScroll: true });
    }
  });
  $("show-breakdown").addEventListener("click", () => {
    $("breakdown").open = true;
    $("breakdown").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("show-first-failure").addEventListener("click", () => {
    if (!globalResult.firstFailure) return;
    setInspection(globalResult.firstFailure.asOf);
    $("show-breakdown").click();
  });
  $("show-rules").addEventListener("click", () => {
    $("rules").open = true;
    $("rules").scrollIntoView({ block: "start", behavior: "smooth" });
    $("rules").querySelector("summary").focus({ preventScroll: true });
  });
  $("add-months").addEventListener("click", () => {
    state.extraMonths += 3;
    renderMonths(true);
    save();
    notify(`Added 3 whole months. Calendar now ends in ${R.monthLabel(months.at(-1))}.`);
  });
  $("undo").addEventListener("click", () => {
    const previous = undoStack.pop();
    if (!previous) return;
    state.pattern = previous.pattern;
    state.overrides = previous.overrides;
    if (Object.hasOwn(previous, "extraMonths")) {
      state.extraMonths = previous.extraMonths;
      state.asOf = previous.asOf;
      $("as-of").value = state.asOf;
      renderMonths();
    }
    $("undo").disabled = !undoStack.length;
    refresh();
    save();
    notify("Last schedule change undone.");
  });
  $("pattern-form").addEventListener("submit", event => {
    event.preventDefault();
    const previous = snapshot();
    state.pattern = Array.from(document.querySelectorAll('input[name="pattern"]:checked'), input => Number(input.value));
    scheduleChanged(previous, `Default pattern updated: ${patternText()}. Explicit edits preserved.`);
  });
  $("reset").addEventListener("click", () => $("reset-dialog").showModal());
  $("reset-cancel").addEventListener("click", () => $("reset-dialog").close());
  $("reset-confirm").addEventListener("click", () => {
    state = R.initialState(R.today());
    displayedToday = R.today();
    undoStack = [];
    $("undo").disabled = true;
    $("as-of").value = state.asOf;
    renderMonths();
    save();
    $("reset-dialog").close();
    notify("Planner reset to the assumed Mon/Tue/Wed office pattern.");
  });

  function transferError(message) {
    $("transfer-error").textContent = message;
    $("transfer-error").hidden = false;
  }
  $("export-plan").addEventListener("click", () => {
    $("transfer-error").hidden = true;
    try {
      const blob = new Blob([R.encodePlan(state)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `office-away-plan-${R.today()}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify("Plan JSON download requested. Keep the file as your backup.");
    } catch (error) {
      transferError(`Export failed: ${error.message} Try again in a browser that supports file downloads.`);
    }
  });
  $("import-plan").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async () => {
    const file = $("import-file").files[0];
    $("import-file").value = "";
    if (!file) return;
    $("transfer-error").hidden = true;
    pendingImport = null;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("The file exceeds the 5 MB limit.");
      pendingImport = R.decodePlan(await file.text());
    } catch (error) {
      transferError(`Import rejected: ${error.message} Choose an unmodified Office / Away JSON export. Your current plan has not changed.`);
      return;
    }
    $("import-description").textContent = `This file has ${pendingImport.pattern.length} default office weekdays, ${Object.keys(pendingImport.overrides).length} explicit day edits, and ${pendingImport.extraMonths} added months.`;
    $("import-dialog").showModal();
  });
  $("import-cancel").addEventListener("click", () => {
    pendingImport = null;
    $("import-dialog").close();
  });
  $("import-dialog").addEventListener("cancel", () => { pendingImport = null; });
  $("import-confirm").addEventListener("click", () => {
    if (!pendingImport) return;
    pushUndo({ ...snapshot(), extraMonths: state.extraMonths, asOf: state.asOf });
    state = pendingImport;
    pendingImport = null;
    $("as-of").value = state.asOf;
    renderMonths();
    save();
    $("import-dialog").close();
    notify(storageError ? "Plan imported in this tab, but saving failed. See the storage warning." : "Plan imported and saved on this device.");
  });

  function updateSticky() {
    scrollScheduled = false;
    const shouldCompact = window.scrollY > $("dashboard-host").offsetTop + 56;
    if (shouldCompact !== compact) {
      if (shouldCompact) $("dashboard-host").style.height = `${$("dashboard").offsetHeight}px`;
      compact = shouldCompact;
      $("dashboard").classList.toggle("is-compact", compact);
      if (!compact) $("dashboard-host").style.height = "";
    }
    if (compact) document.documentElement.style.setProperty("--toolbar-height", `${$("dashboard").offsetHeight}px`);
  }
  function syncStickySize() {
    if (!compact) return;
    const measure = $("dashboard").cloneNode(true);
    measure.removeAttribute("id");
    measure.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    measure.classList.remove("is-compact");
    measure.setAttribute("aria-hidden", "true");
    measure.inert = true;
    Object.assign(measure.style, { position: "absolute", top: "0", width: "100%", visibility: "hidden", pointerEvents: "none" });
    $("dashboard-host").append(measure);
    $("dashboard-host").style.height = `${measure.offsetHeight}px`;
    measure.remove();
    document.documentElement.style.setProperty("--toolbar-height", `${$("dashboard").offsetHeight}px`);
  }
  window.addEventListener("scroll", () => {
    if (!scrollScheduled) {
      scrollScheduled = true;
      requestAnimationFrame(updateSticky);
    }
  }, { passive: true });
  window.addEventListener("resize", () => {
    syncStickySize();
    updateSticky();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && displayedToday !== R.today()) {
      const wasToday = state.asOf === displayedToday;
      displayedToday = R.today();
      if (wasToday) {
        state.asOf = displayedToday;
        $("as-of").value = state.asOf;
      }
      renderMonths();
      save();
    }
  });
  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY) {
      storageError = "This plan changed in another tab. Reload to use that version. Editing here will overwrite it.";
      renderStorage();
    }
  });

  renderMonths();
  renderStorage();
  updateSticky();
})();
