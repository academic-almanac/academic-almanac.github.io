/* ============================================================
   Academic Atlas — presentation layer (v1 mockup)
   ------------------------------------------------------------
   Reads ATLAS_DATA (data.js) and renders three views via hash
   routing: dashboard (#/), and one filterable list per cluster.
   No framework: three list views + client-side filtering don't
   justify one, and this keeps the mockup runnable from file://.

   Structure:
     1. config (clusters, filter definitions)
     2. date/format helpers
     3. filtering
     4. render: dashboard / cluster view / rows / detail
     5. routing + events + countdown ticker
   ============================================================ */

"use strict";

/* ---------- 1. config ---------- */

const DISCIPLINES = ATLAS_DATA.meta.disciplines;

const CLUSTERS = {
  conference: {
    slug: "conferences",
    label: "Conferences",
    tagLabel: "Conference",
    blurb:
      "Flagship and field conferences incl. doctoral consortia and workshops — sorted by the next submission deadline.",
    cardDesc: "Paper deadlines, doctoral consortia and acceptance rates for the venues that matter.",
    // which filters this cluster shows (SIs have no location/format, etc.)
    filters: ["q", "discipline", "ranking", "window", "region", "format", "fee", "dc"],
  },
  "special-issue": {
    slug: "special-issues",
    label: "Special issues",
    tagLabel: "Special issue",
    blurb:
      "Journal calls for papers with the journal's ranking attached — so you can weigh effort against payoff at a glance.",
    cardDesc: "Calls for papers from Basket-of-Eight, FT50 and ABS-ranked journals.",
    filters: ["q", "discipline", "ranking", "window", "fee"],
  },
  course: {
    slug: "courses",
    label: "Summer schools & PhD courses",
    tagLabel: "Course",
    blurb:
      "Credit-bearing doctoral courses and summer/winter schools — apply-by deadlines, ECTS and assessment up front.",
    cardDesc: "ECTS-bearing methods and field courses, from GSERM to EDEN seminars.",
    filters: ["q", "discipline", "window", "region", "format", "fee"],
  },
};

const SLUG_TO_CLUSTER = Object.fromEntries(
  Object.entries(CLUSTERS).map(([id, c]) => [c.slug, id])
);

// Filter field definitions. Options marked `dynamic` are derived
// from the data actually present in the current cluster.
const FILTER_DEFS = {
  q: { type: "search", label: "Search" },
  discipline: { type: "select", label: "Discipline", dynamic: "disciplines" },
  ranking: {
    type: "select",
    label: "Ranking",
    options: [
      ["top", "Top tier (A*, FT50, Basket)"],
      ["high", "High (A, ABS 3)"],
    ],
  },
  window: {
    type: "select",
    label: "Deadline within",
    options: [
      ["30", "Next 30 days"],
      ["90", "Next 90 days"],
      ["180", "Next 6 months"],
    ],
  },
  region: { type: "select", label: "Region", dynamic: "regions" },
  format: {
    type: "select",
    label: "Format",
    options: [
      ["onsite", "On-site"],
      ["hybrid", "Hybrid"],
      ["online", "Online"],
    ],
  },
  fee: {
    type: "select",
    label: "Fee",
    options: [
      ["free", "Free / no fee"],
      ["paid", "Paid"],
    ],
  },
  dc: { type: "check", label: "Has doctoral consortium / workshop" },
};

const EMPTY_FILTERS = { q: "", discipline: "", ranking: "", window: "", region: "", format: "", fee: "", dc: false };

const state = {
  view: "dashboard", // "dashboard" | cluster id
  openId: null,      // item to auto-expand (from #/slug?open=id links)
  filters: { ...EMPTY_FILTERS },
};

/* ---------- 2. helpers ---------- */

const MS_DAY = 86400000;
const $ = (sel, el = document) => el.querySelector(sel);

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(iso) {
  return Math.round((new Date(iso + "T00:00:00") - todayMidnight()) / MS_DAY);
}

function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// countdown label + urgency class, shared by pills everywhere
function countdown(iso, tbd) {
  if (tbd) return { text: "TBD", cls: "u-tbd" };
  const d = daysUntil(iso);
  if (d < 0) return { text: "Closed", cls: "u-closed" };
  if (d === 0) return { text: "Due today", cls: "u-urgent" };
  const text = d === 1 ? "1 day" : `${d} days`;
  return { text, cls: d <= 7 ? "u-urgent" : d <= 30 ? "u-soon" : "u-ok" };
}

// deadline field shown next to the pill — real date, or an honest "not yet published"
function fmtDeadline(item) {
  return item.deadlineTBD ? "Not yet published — check official site" : fmtDate(item.deadline);
}

// Seed data is first-party, but escape anyway so pasted-in real
// data (v2) can never break markup.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function locationText(item) {
  return item.location ? `${item.location.city}, ${item.location.country}` : "—";
}

const FORMAT_LABEL = { onsite: "On-site", hybrid: "Hybrid", online: "Online" };

const byDeadline = (a, b) => a.deadline.localeCompare(b.deadline);

// precompute a lowercase haystack per item for the search box
const ITEMS = ATLAS_DATA.items.map((it) => ({
  ...it,
  _search: [
    it.acronym, it.title, it.description,
    it.specialIssue?.journal, it.course?.university,
    it.conference?.theme, ...(it.specialIssue?.topics ?? []),
    it.location?.city, it.location?.country,
  ].filter(Boolean).join(" ").toLowerCase(),
}));

/* ---------- 3. filtering ---------- */

function applyFilters(items, f) {
  return items
    .filter((it) => {
      if (f.q && !it._search.includes(f.q.toLowerCase().trim())) return false;
      if (f.discipline && !it.disciplines.includes(f.discipline)) return false;
      if (f.ranking && it.ranking.band !== f.ranking) return false;
      if (f.window && daysUntil(it.deadline) > Number(f.window)) return false;
      if (f.region && it.region !== f.region) return false;
      if (f.format && it.format !== f.format) return false;
      if (f.fee && it.feeType !== f.fee) return false;
      if (f.dc && !it.conference?.doctoralConsortium) return false;
      return true;
    })
    .sort(byDeadline);
}

/* ---------- 4. rendering ---------- */

const app = $("#app");

function renderDashboard() {
  const upcoming = [...ITEMS].sort(byDeadline).filter((it) => daysUntil(it.deadline) >= 0);
  const soonest = upcoming.slice(0, 6);

  const clusterCards = Object.entries(CLUSTERS).map(([id, c]) => {
    const items = upcoming.filter((it) => it.cluster === id);
    const next = items[0];
    return `
      <a class="cluster-card" href="#/${c.slug}">
        <span class="cluster-tag ${id}">${c.tagLabel}s</span>
        <h3>${c.label}</h3>
        <span class="cluster-desc">${c.cardDesc}</span>
        <span class="cluster-next">Next deadline: <strong>${next ? `${esc(next.acronym)} · ${fmtDate(next.deadline)}` : "—"}</strong></span>
        <span class="cluster-cta">Browse ${items.length} listings →</span>
      </a>`;
  }).join("");

  const soonCards = soonest.map((it) => {
    const cd = countdown(it.deadline, it.deadlineTBD);
    return `
      <a class="soon-card" href="#/${CLUSTERS[it.cluster].slug}?open=${it.id}">
        <span class="soon-card-top">
          <span class="cluster-tag ${it.cluster}">${CLUSTERS[it.cluster].tagLabel}</span>
          <span class="pill ${cd.cls}" data-deadline="${it.deadline}" data-tbd="${it.deadlineTBD ? "1" : ""}">${cd.text}</span>
        </span>
        <span class="item-name">${esc(it.acronym)}</span>
        <span class="item-sub">${esc(it.deadlineLabel)} · ${fmtDeadline(it)}</span>
      </a>`;
  }).join("");

  app.innerHTML = `
    <section class="hero">
      <h1>Every deadline that matters, on <em>one</em> page.</h1>
      <p>Conferences, journal special issues and PhD courses for Information Systems,
         Entrepreneurship &amp; Management, and Finance &amp; Economics — with rankings
         attached and a direct path to the submission system. No hunting across ten sites.</p>
      <div class="hero-meta">
        <span><strong>${ITEMS.length}</strong> curated listings</span>
        <span><strong>3</strong> disciplines, done properly</span>
        <span>Data updated <strong>${fmtDate(ATLAS_DATA.meta.lastUpdated)}</strong></span>
      </div>
    </section>

    <section class="section" aria-labelledby="soon-h">
      <div class="section-head">
        <h2 id="soon-h">Closing soon</h2>
        <span class="section-sub">Nearest deadlines across all clusters</span>
      </div>
      <div class="soon-grid">${soonCards}</div>
    </section>

    <section class="section" aria-labelledby="clusters-h">
      <div class="section-head">
        <h2 id="clusters-h">Browse by cluster</h2>
        <!-- v2 stub: unified rolling calendar across clusters -->
        <button class="btn btn-secondary" disabled title="Planned for v2 — unified rolling calendar">
          Calendar view · soon
        </button>
      </div>
      <div class="cluster-grid">${clusterCards}</div>
    </section>`;
}

/* ----- cluster view ----- */

function filterFieldHTML(key, cluster) {
  const def = FILTER_DEFS[key];
  const id = `f-${key}`;

  if (def.type === "search") {
    return `
      <div class="filter-field">
        <label for="${id}">${def.label}</label>
        <input type="search" id="${id}" data-filter="q" placeholder="Venue, topic, city…" autocomplete="off" />
      </div>`;
  }

  if (def.type === "check") {
    return `
      <label class="filter-check">
        <input type="checkbox" data-filter="dc" /> ${def.label}
      </label>`;
  }

  let options = def.options;
  if (def.dynamic === "disciplines") {
    options = Object.entries(DISCIPLINES).filter(([code]) =>
      ITEMS.some((it) => it.cluster === cluster && it.disciplines.includes(code)));
  } else if (def.dynamic === "regions") {
    options = [...new Set(
      ITEMS.filter((it) => it.cluster === cluster && it.region).map((it) => it.region)
    )].sort().map((r) => [r, r]);
  }

  return `
    <div class="filter-field">
      <label for="${id}">${def.label}</label>
      <select id="${id}" data-filter="${key}">
        <option value="">Any</option>
        ${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
      </select>
    </div>`;
}

function renderClusterView(clusterId) {
  const c = CLUSTERS[clusterId];
  app.innerHTML = `
    <div class="view-head">
      <h1>${c.label}</h1>
      <p>${c.blurb}</p>
    </div>
    <form class="filter-bar" role="search" aria-label="Filter ${c.label}" onsubmit="return false">
      ${c.filters.map((k) => filterFieldHTML(k, clusterId)).join("")}
      <div class="filter-actions">
        <button type="button" class="btn btn-ghost" id="clear-filters">Clear filters</button>
      </div>
    </form>
    <p class="result-count" id="result-count" role="status"></p>
    <ul class="rows" id="rows"></ul>`;

  // wire filters: instant updates, list-only re-render (keeps focus in inputs)
  $(".filter-bar").addEventListener("input", (e) => {
    const key = e.target.dataset.filter;
    if (!key) return;
    state.filters[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    state.openId = null;
    renderRows(clusterId);
  });
  $("#clear-filters").addEventListener("click", () => {
    state.filters = { ...EMPTY_FILTERS };
    $(".filter-bar").querySelectorAll("select, input[type=search]").forEach((el) => (el.value = ""));
    const cb = $(".filter-bar input[type=checkbox]");
    if (cb) cb.checked = false;
    renderRows(clusterId);
  });

  // row expand/collapse via event delegation
  $("#rows").addEventListener("click", (e) => {
    const head = e.target.closest(".row-head");
    if (!head || e.target.closest("a")) return;
    const row = head.closest(".row");
    const open = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!open));
    row.classList.toggle("is-open", !open);
    $(".row-detail", row).hidden = open;
  });

  renderRows(clusterId);
}

function renderRows(clusterId) {
  const items = applyFilters(ITEMS.filter((it) => it.cluster === clusterId), state.filters);
  const rowsEl = $("#rows");
  const noun = CLUSTERS[clusterId].tagLabel.toLowerCase();

  $("#result-count").textContent = items.length
    ? `${items.length} ${noun}${items.length === 1 ? "" : "s"} · sorted by soonest deadline`
    : "";

  if (!items.length) {
    rowsEl.innerHTML = `
      <li class="empty">
        <h3>Nothing matches these filters</h3>
        <p>Try widening the deadline window or clearing a filter — nothing is hidden behind an algorithm.</p>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('clear-filters').click()">Clear all filters</button>
      </li>`;
    return;
  }

  rowsEl.innerHTML = items.map(rowHTML).join("");

  // deep link from dashboard ("open=…"): expand and scroll to the item
  if (state.openId) {
    const head = $(`#item-${state.openId} .row-head`);
    if (head) {
      head.click();
      head.scrollIntoView({ block: "center" });
    }
    state.openId = null;
  }
}

function rowHTML(item) {
  const cd = countdown(item.deadline, item.deadlineTBD);
  const chips = [
    ...item.disciplines.map((d) => `<span class="chip">${DISCIPLINES[d]}</span>`),
    item.ranking.band !== "na"
      ? `<span class="chip chip-rank">${esc(item.ranking.label)}</span>`
      : `<span class="chip">${esc(item.ranking.label)}</span>`,
  ].join("");

  return `
    <li class="row" id="item-${item.id}">
      <button class="row-head" aria-expanded="false" aria-controls="detail-${item.id}">
        <span class="pill ${cd.cls}" data-deadline="${item.deadline}" data-tbd="${item.deadlineTBD ? "1" : ""}">${cd.text}</span>
        <span class="row-main">
          <span class="row-title"><strong>${esc(item.acronym)}</strong><span class="t-sep">·</span>${esc(item.title)}</span>
          <span class="row-chips">${chips}</span>
        </span>
        <span class="row-when">
          <span class="lbl">${esc(item.deadlineLabel)}</span>
          ${fmtDeadline(item)}
        </span>
        <span class="row-where">
          ${esc(locationText(item))}
          ${item.format ? `<span class="fmt">${FORMAT_LABEL[item.format]}</span>` : ""}
        </span>
        <svg class="caret" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="row-detail" id="detail-${item.id}" hidden>${detailHTML(item)}</div>
    </li>`;
}

/* ----- detail panel (cluster-specific fields) ----- */

function dd(label, value) {
  return value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : "";
}

function detailHTML(item) {
  let fields = "";
  let topics = "";

  if (item.conference) {
    const cf = item.conference;
    fields = [
      dd("Conference dates", esc(cf.dates)),
      dd("Location", esc(locationText(item))),
      dd("Acceptance rate", esc(cf.acceptanceRate)),
      dd("Theme", esc(cf.theme)),
      dd("Doctoral consortium", cf.doctoralConsortium ? "Yes" : "No"),
      dd("Fee", esc(item.fee)),
    ].join("");
  } else if (item.specialIssue) {
    const si = item.specialIssue;
    fields = [
      dd("Journal", esc(si.journal)),
      dd("Journal ranking", esc(si.journalRanking)),
      dd("Submission deadline", fmtDate(item.deadline)),
      dd("Fee", esc(item.fee)),
      dd("Guidelines", `<a href="${si.guidelinesUrl}" target="_blank" rel="noopener">Submission guidelines ↗</a>`),
    ].join("");
    topics = `
      <div class="detail-topics">
        <dt class="visually-hidden">Topics</dt>
        <strong style="font-size:12.5px">Topics include</strong>
        <ul>${si.topics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </div>`;
  } else if (item.course) {
    const co = item.course;
    fields = [
      dd("Period", esc(co.period)),
      dd("University", esc(co.university)),
      dd("Location", esc(locationText(item))),
      dd("Credits", `${co.ects} ECTS`),
      dd("Requirements", esc(co.requirements)),
      dd("Assessment", esc(co.assessment)),
      dd("Fee", esc(item.fee)),
    ].join("");
  }

  const verifiedDays = Math.max(0, -daysUntil(item.verified));
  const verifiedText = verifiedDays === 0 ? "today" : verifiedDays === 1 ? "1 day ago" : `${verifiedDays} days ago`;
  const submitLabel = item.cluster === "course" ? "Go to application" : "Go to submission";

  return `
    <p class="detail-desc">${esc(item.description)}</p>
    <dl class="detail-grid">${fields}</dl>
    ${topics}
    <div class="detail-actions">
      <a class="btn btn-primary" href="${item.submitUrl}" target="_blank" rel="noopener">${submitLabel} ↗</a>
      <a class="btn btn-secondary" href="${item.officialUrl}" target="_blank" rel="noopener">Official site ↗</a>
      <!-- v2 stub: generates an .ics once data is live -->
      <button class="btn btn-secondary" disabled title="Planned for v2 — deadline reminders">Add to calendar</button>
    </div>
    <div class="detail-trust">
      <span class="verified">✓ Verified ${verifiedText}</span>
      <a href="mailto:corrections@academic-atlas.example?subject=Correction:%20${encodeURIComponent(item.acronym)}">Report a correction</a>
    </div>`;
}

/* ---------- 5. routing + countdown ticker ---------- */

function route() {
  // hash forms: "#/", "#/conferences", "#/conferences?open=<id>"
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const clusterId = SLUG_TO_CLUSTER[path];

  state.openId = new URLSearchParams(query).get("open");
  state.view = clusterId ?? "dashboard";
  state.filters = { ...EMPTY_FILTERS }; // each view starts unfiltered

  if (clusterId) renderClusterView(clusterId);
  else renderDashboard();

  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === state.view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
}

// Keep countdown pills honest if the tab stays open across midnight.
setInterval(() => {
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const cd = countdown(el.dataset.deadline, el.dataset.tbd === "1");
    el.textContent = cd.text;
    el.className = `pill ${cd.cls}`;
  });
}, 60000);

window.addEventListener("hashchange", route);
route();
