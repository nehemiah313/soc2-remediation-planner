/* SOC 2 Remediation Plan Generator
 * Static app. Reads data/tsc.json, imports gaps from the Readiness
 * Calculator localStorage key "soc2calc", persists plan under "soc2remed".
 * No backend. Works offline and on GitHub Pages.
 */
"use strict";

/* ---------------- Pure logic (testable in node) ---------------- */

const CALC_KEY = "soc2calc";
const PLAN_KEY = "soc2remed";

const CATEGORY_ORDER = ["Security", "Availability", "Processing Integrity", "Confidentiality", "Privacy"];
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2 };

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sort plan items: critical priority first, then category order, then criterion id. Custom items last. */
function sortItems(items, criteriaById) {
  const catRank = (c) => CATEGORY_ORDER.indexOf(c);
  return items.slice().sort((a, b) => {
    const ca = a.criterionId ? criteriaById[a.criterionId] : null;
    const cb = b.criterionId ? criteriaById[b.criterionId] : null;
    if (!ca && cb) return 1;
    if (ca && !cb) return -1;
    if (!ca && !cb) return 0;
    const pr = (PRIORITY_RANK[ca.priority] ?? 9) - (PRIORITY_RANK[cb.priority] ?? 9);
    if (pr !== 0) return pr;
    const cr = catRank(ca.category) - catRank(cb.category);
    if (cr !== 0) return cr;
    return ca.id.localeCompare(cb.id, undefined, { numeric: true });
  });
}

/** Assign staggered weekly target dates: item i -> start + 7*i days. */
function staggerDates(items, startISO) {
  return items.map((it, i) => Object.assign({}, it, {
    targetDate: it.targetDate || addDaysISO(startISO, i * 7),
  }));
}

/** Extract gap criterion ids from a Readiness Calculator payload (defensive: several shapes). */
function extractGaps(payload, criteriaById) {
  if (!payload || typeof payload !== "object") return null;
  let scope = null;
  if (Array.isArray(payload.scope)) scope = payload.scope;
  else if (Array.isArray(payload.categories)) scope = payload.categories;
  const inScope = (id) => !scope || scope.includes(criteriaById[id] && criteriaById[id].category);

  let ids = null;
  if (payload.statuses && typeof payload.statuses === "object") {
    const doneVals = new Set(["done", "implemented", "met", "complete", "completed"]);
    ids = Object.keys(payload.statuses).filter(
      (id) => criteriaById[id] && !doneVals.has(String(payload.statuses[id]).toLowerCase())
    );
  } else if (Array.isArray(payload.gaps)) {
    ids = payload.gaps.filter((id) => criteriaById[id]);
  } else if (Array.isArray(payload.criteria)) {
    const doneVals = new Set(["done", "implemented", "met", "complete", "completed"]);
    ids = payload.criteria
      .filter((c) => c && criteriaById[c.id] && !doneVals.has(String(c.status || "").toLowerCase()))
      .map((c) => c.id);
  }
  if (!ids) return null;
  return ids.filter(inScope);
}

function buildItem(criterionId, criteriaById, overrides) {
  const c = criteriaById[criterionId];
  const item = {
    uid: "it-" + Math.random().toString(36).slice(2, 10),
    criterionId: criterionId || null,
    title: c ? c.id + " " + c.title : "Custom action item",
    summary: c ? c.summary : "",
    evidence: c ? c.typical_evidence.slice() : [],
    owner: "",
    targetDate: "",
    notes: "",
    status: "Not started",
  };
  return Object.assign(item, overrides || {});
}

function progressStats(items) {
  const total = items.length;
  const done = items.filter((i) => i.status === "Done").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, pct };
}

function escapeCsv(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv(items, criteriaById) {
  const rows = [["#", "Criterion ID", "Title", "Category", "Priority", "Owner", "Target Date", "Status", "Suggested Evidence", "Notes"]];
  items.forEach((it, i) => {
    const c = it.criterionId ? criteriaById[it.criterionId] : null;
    rows.push([
      i + 1,
      it.criterionId || "custom",
      c ? c.title : it.title,
      c ? c.category : "Custom",
      c ? c.priority : "",
      it.owner,
      it.targetDate,
      it.status,
      (it.evidence || []).join("; "),
      it.notes,
    ]);
  });
  return rows.map((r) => r.map(escapeCsv).join(",")).join("\r\n");
}

function exportMarkdown(items, criteriaById) {
  const stats = progressStats(items);
  const lines = [];
  lines.push("# SOC 2 Remediation Plan");
  lines.push("");
  lines.push("Generated " + todayISO() + " with the SOC 2 Remediation Plan Generator.");
  lines.push("");
  lines.push("Progress: " + stats.done + " of " + stats.total + " items done (" + stats.pct + "%).");
  lines.push("");
  lines.push("> Readiness aid only. Not an audit, attestation, CPA opinion, or legal advice.");
  lines.push("");
  items.forEach((it, i) => {
    const c = it.criterionId ? criteriaById[it.criterionId] : null;
    const head = it.criterionId ? it.criterionId + " " + (c ? c.title : "") : it.title;
    lines.push("## " + (i + 1) + ". " + head);
    lines.push("");
    if (c) {
      lines.push("- Category: " + c.category + " | Priority: " + c.priority);
      lines.push("- Summary: " + c.summary);
    } else {
      lines.push("- Category: Custom action item");
    }
    if (it.evidence && it.evidence.length) lines.push("- Suggested evidence: " + it.evidence.join("; "));
    lines.push("- Owner: " + (it.owner || "unassigned"));
    lines.push("- Target date: " + (it.targetDate || "not set"));
    lines.push("- Status: " + it.status);
    if (it.notes) lines.push("- Notes: " + it.notes);
    lines.push("");
  });
  return lines.join("\n");
}

/* ---------------- Lead capture (silent backend) ----------------
 * Set REPORT_INBOX to the inbox that receives review requests. When set, a
 * "Get your plan reviewed" form appears: the visitor enters their work email,
 * their full Markdown plan downloads immediately, and their email, plan
 * summary, and top critical items are silently POSTed to LEAD_CAPTURE_URL
 * (a backend failure never blocks the download). Leave "" to hide the form.
 */
const REPORT_INBOX = "n.harvard@aitechpros.ai";
const LEAD_STORE_KEY = "soc2remedlead";
const LEAD_CAPTURE_URL = "https://leads.aitechpros.ai/capture";

/* Silent lead capture: POSTs the visitor's email, plan summary, and top
 * critical items to the lead-capture endpoint. Fire-and-forget: a backend
 * failure must never block the visitor's plan download. */
function captureLead(payload) {
  try {
    fetch(LEAD_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({
        page_url: (typeof location !== "undefined" && location.href) || "",
        hp: ""
      }, payload)),
      keepalive: true
    }).catch(function () { /* never block the download */ });
  } catch (e) { /* never block the download */ }
}

function buildLeadSubject(company) {
  return "SOC 2 Remediation Plan review request" + (company ? " - " + company : "");
}

function openCriticalItems(items, criteriaById) {
  return items.filter((i) => {
    const c = i.criterionId ? criteriaById[i.criterionId] : null;
    return c && c.priority === "critical" && i.status !== "Done";
  });
}

/* Compact summary for the review-request email body. Pure: safe to unit test. */
function buildLeadBody(visitorEmail, company, items, criteriaById) {
  const stats = progressStats(items);
  const critical = openCriticalItems(items, criteriaById);
  const lines = [
    "SOC 2 Remediation Plan review request",
    "",
    "Visitor email: " + visitorEmail,
    "Company: " + (company || "(not given)"),
    "Plan items: " + stats.total + " (done: " + stats.done +
      ", open critical: " + critical.length + ")",
    ""
  ];
  const top = critical.slice(0, 8);
  if (top.length) {
    lines.push("Top open critical items:");
    top.forEach((i) => {
      const c = criteriaById[i.criterionId];
      lines.push("- " + i.criterionId + ": " + (c ? c.title : i.title || ""));
    });
    lines.push("");
  }
  lines.push("The visitor downloaded their full plan from the SOC 2 Remediation Planner.");
  return lines.join("\n");
}

function leadMailto(inbox, subject, body) {
  return "mailto:" + inbox + "?subject=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function loadLead() {
  try {
    const raw = window.localStorage.getItem(LEAD_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveLead(lead) {
  try { window.localStorage.setItem(LEAD_STORE_KEY, JSON.stringify(lead)); }
  catch (e) { /* storage unavailable; lead capture still works */ }
}

/* Export for node tests */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { sortItems, staggerDates, extractGaps, buildItem, progressStats, exportCsv, exportMarkdown, addDaysISO, todayISO, CATEGORY_ORDER, PRIORITY_RANK, CALC_KEY, PLAN_KEY, buildLeadSubject, openCriticalItems, buildLeadBody, leadMailto, isValidEmail, REPORT_INBOX, LEAD_STORE_KEY };
}

/* ---------------- Browser app ---------------- */
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

let CRITERIA = [];
let BY_ID = {};
let PLAN = [];

function init() {
  fetch("data/tsc.json")
    .then((r) => { if (!r.ok) throw new Error("dataset load failed"); return r.json(); })
    .then((ds) => {
      CRITERIA = ds.criteria;
      BY_ID = {};
      CRITERIA.forEach((c) => { BY_ID[c.id] = c; });
      loadPlan();
      buildFilters();
      renderCriteriaList();
      renderPlan();
    })
    .catch((e) => {
      document.getElementById("importStatus").textContent = "Could not load data/tsc.json. Serve over http or check the file.";
      document.getElementById("importStatus").className = "status warn";
    });

  document.getElementById("btnImport").addEventListener("click", importFromCalculator);
  document.getElementById("btnClear").addEventListener("click", clearPlan);
  document.getElementById("btnAddCustom").addEventListener("click", addCustomItem);
  document.getElementById("btnExportCsv").addEventListener("click", () => download("soc2-remediation-plan.csv", exportCsv(PLAN, BY_ID), "text/csv"));
  document.getElementById("btnExportMd").addEventListener("click", () => download("soc2-remediation-plan.md", exportMarkdown(PLAN, BY_ID), "text/markdown"));
  document.getElementById("filterCat").addEventListener("change", renderCriteriaList);
  document.getElementById("filterPri").addEventListener("change", renderCriteriaList);
  document.getElementById("filterText").addEventListener("input", renderCriteriaList);

  const leadCapture = document.getElementById("leadCapture");
  if (!REPORT_INBOX) {
    leadCapture.hidden = true;
  } else {
    const savedLead = loadLead();
    if (savedLead) {
      if (savedLead.email) document.getElementById("leadEmail").value = savedLead.email;
      if (savedLead.company) document.getElementById("leadCompany").value = savedLead.company;
    }
    document.getElementById("leadForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const emailEl = document.getElementById("leadEmail");
      const companyEl = document.getElementById("leadCompany");
      const statusEl = document.getElementById("leadStatus");
      const visitorEmail = emailEl.value.trim();
      const company = companyEl.value.trim();
      if (!isValidEmail(visitorEmail)) {
        statusEl.textContent = "Enter a valid work email address.";
        emailEl.focus();
        return;
      }
      if (PLAN.length === 0) {
        statusEl.textContent = "Your plan is empty. Add criteria above first.";
        return;
      }
      download("soc2-remediation-plan.md", exportMarkdown(PLAN, BY_ID), "text/markdown");
      saveLead({ email: visitorEmail, company: company });
      const stats = progressStats(PLAN);
      const critical = openCriticalItems(PLAN, BY_ID);
      captureLead({
        email: visitorEmail,
        tool: "soc2-remediation-planner",
        score: "Plan items: " + stats.total + " (done: " + stats.done +
          ", open critical: " + critical.length + ")",
        summary: {
          company: company,
          topGaps: critical.slice(0, 8).map((i) => {
            const c = BY_ID[i.criterionId];
            return i.criterionId + ": " + (c ? c.title : i.title || "");
          })
        }
      });
      statusEl.textContent = "Plan downloaded. Check your inbox: your results summary and next steps are on the way.";
    });
  }
}

function loadPlan() {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      PLAN = Array.isArray(parsed) ? parsed : (parsed.items || []);
    }
  } catch (e) { PLAN = []; }
}

function savePlan() {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify({ items: PLAN })); } catch (e) { /* storage unavailable */ }
}

function setStatus(msg, ok) {
  const el = document.getElementById("importStatus");
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "warn");
}

function buildFilters() {
  const sel = document.getElementById("filterCat");
  CATEGORY_ORDER.forEach((c) => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

function renderCriteriaList() {
  const cat = document.getElementById("filterCat").value;
  const pri = document.getElementById("filterPri").value;
  const q = document.getElementById("filterText").value.trim().toLowerCase();
  const inPlan = new Set(PLAN.map((i) => i.criterionId).filter(Boolean));
  const list = document.getElementById("criteriaList");
  list.innerHTML = "";
  CRITERIA
    .filter((c) => (!cat || c.category === cat) && (!pri || c.priority === pri))
    .filter((c) => !q || (c.id + " " + c.title + " " + c.summary).toLowerCase().includes(q))
    .forEach((c) => {
      const div = document.createElement("div");
      div.className = "crit";
      const btn = document.createElement("button");
      btn.className = "btn small";
      btn.textContent = inPlan.has(c.id) ? "In plan" : "Add";
      btn.disabled = inPlan.has(c.id);
      btn.addEventListener("click", () => addCriterion(c.id));
      div.innerHTML = "";
      const cid = document.createElement("span");
      cid.className = "cid"; cid.textContent = c.id;
      const body = document.createElement("div");
      body.className = "body";
      const t = document.createElement("div");
      t.className = "title"; t.textContent = c.title;
      const badge = document.createElement("span");
      badge.className = "badge " + c.priority; badge.textContent = c.priority;
      t.appendChild(badge);
      const m = document.createElement("div");
      m.className = "meta"; m.textContent = c.category + " | " + c.series_name;
      body.appendChild(t); body.appendChild(m);
      div.appendChild(cid); div.appendChild(body); div.appendChild(btn);
      list.appendChild(div);
    });
}

function nextTargetDate() {
  if (PLAN.length === 0) return todayISO();
  const dates = PLAN.map((i) => i.targetDate).filter(Boolean).sort();
  return dates.length ? addDaysISO(dates[dates.length - 1], 7) : todayISO();
}

function addCriterion(criterionId) {
  const item = buildItem(criterionId, BY_ID, { targetDate: nextTargetDate() });
  PLAN.push(item);
  PLAN = sortItems(PLAN, BY_ID);
  savePlan(); renderPlan(); renderCriteriaList();
  setStatus(criterionId + " added to the plan.", true);
}

function addCustomItem() {
  const item = buildItem(null, BY_ID, { targetDate: nextTargetDate() });
  PLAN.push(item);
  PLAN = sortItems(PLAN, BY_ID);
  savePlan(); renderPlan();
}

function importFromCalculator() {
  let payload = null;
  try {
    const raw = localStorage.getItem(CALC_KEY);
    if (raw) payload = JSON.parse(raw);
  } catch (e) { payload = null; }
  const gaps = extractGaps(payload, BY_ID);
  if (gaps === null) {
    setStatus("No calculator data found under key \"" + CALC_KEY + "\". Add criteria manually below.", false);
    return;
  }
  const existing = new Set(PLAN.map((i) => i.criterionId).filter(Boolean));
  const fresh = gaps.filter((id) => !existing.has(id));
  let base = todayISO();
  const dates = PLAN.map((i) => i.targetDate).filter(Boolean).sort();
  if (dates.length) base = addDaysISO(dates[dates.length - 1], 7);
  fresh.forEach((id, i) => {
    PLAN.push(buildItem(id, BY_ID, { targetDate: addDaysISO(base, i * 7) }));
  });
  PLAN = sortItems(PLAN, BY_ID);
  savePlan(); renderPlan(); renderCriteriaList();
  setStatus("Imported " + fresh.length + " gap(s)" + (gaps.length - fresh.length ? " (" + (gaps.length - fresh.length) + " already in plan)" : "") + ".", true);
}

function clearPlan() {
  if (!PLAN.length) return;
  if (confirm("Remove all items from the plan?")) {
    PLAN = [];
    savePlan(); renderPlan(); renderCriteriaList();
    setStatus("Plan cleared.", true);
  }
}

function renderPlan() {
  const list = document.getElementById("planList");
  list.innerHTML = "";
  const stats = progressStats(PLAN);
  document.getElementById("progressBar").style.width = stats.pct + "%";
  document.getElementById("progressLabel").textContent =
    stats.total === 0 ? "" : stats.done + " of " + stats.total + " done (" + stats.pct + "%)";
  document.getElementById("emptyPlan").style.display = stats.total ? "none" : "";

  PLAN.forEach((item, idx) => {
    const c = item.criterionId ? BY_ID[item.criterionId] : null;
    const div = document.createElement("div");
    div.className = "plan-item" + (item.status === "Done" ? " done" : "");

    const head = document.createElement("div");
    head.className = "plan-head";
    const num = document.createElement("div");
    num.className = "num"; num.textContent = (idx + 1) + ".";
    const main = document.createElement("div");
    main.className = "main";

    if (c) {
      const cid = document.createElement("div");
      cid.innerHTML = "";
      const idSpan = document.createElement("span");
      idSpan.className = "cid"; idSpan.textContent = c.id;
      const titleSpan = document.createElement("span");
      titleSpan.className = "title"; titleSpan.textContent = " " + c.title;
      const badge = document.createElement("span");
      badge.className = "badge " + c.priority; badge.textContent = c.priority;
      cid.appendChild(idSpan); cid.appendChild(titleSpan); cid.appendChild(badge);
      const sum = document.createElement("p");
      sum.className = "summary"; sum.textContent = c.summary;
      const ev = document.createElement("p");
      ev.className = "evidence";
      ev.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = "Suggested evidence: ";
      ev.appendChild(strong);
      ev.appendChild(document.createTextNode(item.evidence.join("; ")));
      main.appendChild(cid); main.appendChild(sum); main.appendChild(ev);
    } else {
      const titleInput = document.createElement("input");
      titleInput.type = "text"; titleInput.value = item.title;
      titleInput.placeholder = "Custom action item title";
      titleInput.style.width = "100%";
      titleInput.addEventListener("input", () => { item.title = titleInput.value; savePlan(); });
      main.appendChild(titleInput);
    }

    const fields = document.createElement("div");
    fields.className = "plan-fields";

    const ownerL = document.createElement("label");
    ownerL.textContent = "Owner";
    const ownerI = document.createElement("input");
    ownerI.type = "text"; ownerI.value = item.owner; ownerI.placeholder = "e.g. Jane D., CTO";
    ownerI.addEventListener("input", () => { item.owner = ownerI.value; savePlan(); });
    ownerL.appendChild(ownerI);

    const dateL = document.createElement("label");
    dateL.textContent = "Target date";
    const dateI = document.createElement("input");
    dateI.type = "date"; dateI.value = item.targetDate || "";
    dateI.addEventListener("change", () => { item.targetDate = dateI.value; savePlan(); });
    dateL.appendChild(dateI);

    const statusL = document.createElement("label");
    statusL.textContent = "Status";
    const statusS = document.createElement("select");
    ["Not started", "In progress", "Done"].forEach((s) => {
      const o = document.createElement("option");
      o.value = s; o.textContent = s;
      if (item.status === s) o.selected = true;
      statusS.appendChild(o);
    });
    statusS.addEventListener("change", () => { item.status = statusS.value; savePlan(); renderPlan(); });
    statusL.appendChild(statusS);

    const notesL = document.createElement("label");
    notesL.textContent = "Notes";
    const notesT = document.createElement("textarea");
    notesT.value = item.notes; notesT.placeholder = "Blockers, dependencies, decisions...";
    notesT.addEventListener("input", () => { item.notes = notesT.value; savePlan(); });
    notesL.appendChild(notesT);

    fields.appendChild(ownerL); fields.appendChild(dateL); fields.appendChild(statusL); fields.appendChild(notesL);
    main.appendChild(fields);

    const move = document.createElement("div");
    move.className = "move-btns";
    const up = document.createElement("button");
    up.className = "btn small"; up.textContent = "Up"; up.disabled = idx === 0;
    up.addEventListener("click", () => moveItem(idx, -1));
    const down = document.createElement("button");
    down.className = "btn small"; down.textContent = "Down"; down.disabled = idx === PLAN.length - 1;
    down.addEventListener("click", () => moveItem(idx, 1));
    const del = document.createElement("button");
    del.className = "btn small danger"; del.textContent = "Remove";
    del.addEventListener("click", () => {
      PLAN.splice(idx, 1);
      savePlan(); renderPlan(); renderCriteriaList();
    });
    move.appendChild(up); move.appendChild(down); move.appendChild(del);

    head.appendChild(num); head.appendChild(main); head.appendChild(move);
    div.appendChild(head);
    list.appendChild(div);
  });
}

function moveItem(idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= PLAN.length) return;
  const tmp = PLAN[idx];
  PLAN[idx] = PLAN[j];
  PLAN[j] = tmp;
  savePlan(); renderPlan();
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}
