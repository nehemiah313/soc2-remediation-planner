#!/usr/bin/env node
/* Verification for soc2-remediation-planner pure logic. */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dir = path.dirname(__filename);
const ds = JSON.parse(fs.readFileSync(path.join(dir, "data", "tsc.json"), "utf8"));
const lib = require(path.join(dir, "app.js"));

let pass = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("PASS", name); }
  catch (e) { console.error("FAIL", name, "-", e.message); process.exitCode = 1; }
}

const BY_ID = {};
ds.criteria.forEach((c) => { BY_ID[c.id] = c; });

check("61 criteria load", () => {
  assert.strictEqual(ds.criteria.length, 61, "expected 61, got " + ds.criteria.length);
});

check("import mapping: statuses-object payload", () => {
  const payload = {
    scope: ["Security", "Availability"],
    statuses: { "CC6.1": "not-started", "CC1.1": "implemented", "A1.1": "in-progress", "PI1.1": "done", "NOPE": "not-started" },
  };
  const gaps = lib.extractGaps(payload, BY_ID);
  assert.deepStrictEqual(gaps.sort(), ["A1.1", "CC6.1"].sort());
});

check("import mapping: gaps-array payload", () => {
  const gaps = lib.extractGaps({ gaps: ["P1.1", "C1.2", "BOGUS"] }, BY_ID);
  assert.deepStrictEqual(gaps.sort(), ["C1.2", "P1.1"].sort());
});

check("import mapping: criteria-array payload", () => {
  const payload = { criteria: [{ id: "CC7.4", status: "planned" }, { id: "CC7.1", status: "Done" }] };
  const gaps = lib.extractGaps(payload, BY_ID);
  assert.deepStrictEqual(gaps, ["CC7.4"]);
});

check("import mapping: absent payload returns null", () => {
  assert.strictEqual(lib.extractGaps(null, BY_ID), null);
  assert.strictEqual(lib.extractGaps("junk", BY_ID), null);
  assert.strictEqual(lib.extractGaps({}, BY_ID), null);
});

check("ordering: critical first, then category order", () => {
  const ids = ["P1.1", "CC1.1", "A1.1", "CC6.1", "PI1.2", "C1.1", "CC9.2"];
  const items = ids.map((id) => lib.buildItem(id, BY_ID));
  const sorted = lib.sortItems(items, BY_ID);
  const order = sorted.map((i) => i.criterionId);
  // critical: CC6.1, CC9.2 first (Security), then remaining Security CC1.1, then Availability, PI, Confidentiality, Privacy
  assert.deepStrictEqual(order, ["CC6.1", "CC9.2", "CC1.1", "A1.1", "PI1.2", "C1.1", "P1.1"]);
});

check("custom items sort last", () => {
  const items = [lib.buildItem(null, BY_ID), lib.buildItem("CC6.1", BY_ID)];
  const sorted = lib.sortItems(items, BY_ID);
  assert.strictEqual(sorted[0].criterionId, "CC6.1");
  assert.strictEqual(sorted[1].criterionId, null);
});

check("staggered dates: weekly from start", () => {
  const items = ["CC6.1", "CC1.1", "A1.1"].map((id) => lib.buildItem(id, BY_ID));
  const out = lib.staggerDates(items, "2026-09-30");
  assert.deepStrictEqual(out.map((i) => i.targetDate), ["2026-09-30", "2026-10-07", "2026-10-14"]);
});

check("staggerDates preserves existing dates", () => {
  const items = [lib.buildItem("CC6.1", BY_ID, { targetDate: "2026-12-01" })];
  const out = lib.staggerDates(items, "2026-09-30");
  assert.strictEqual(out[0].targetDate, "2026-12-01");
});

check("progress stats", () => {
  const items = [
    lib.buildItem("CC6.1", BY_ID, { status: "Done" }),
    lib.buildItem("CC1.1", BY_ID, { status: "In progress" }),
    lib.buildItem("A1.1", BY_ID, { status: "Not started" }),
  ];
  const s = lib.progressStats(items);
  assert.deepStrictEqual(s, { total: 3, done: 1, pct: 33 });
  assert.deepStrictEqual(lib.progressStats([]), { total: 0, done: 0, pct: 0 });
});

check("CSV export valid", () => {
  const items = [lib.buildItem("CC6.1", BY_ID, { owner: 'Jane "JD" Doe', targetDate: "2026-10-07", status: "In progress", notes: "a,b" })];
  const csv = lib.exportCsv(items, BY_ID);
  const lines = csv.split("\r\n");
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[0].startsWith("#,Criterion ID,Title"), "header row");
  assert.ok(lines[1].includes("CC6.1"), "criterion id present");
  assert.ok(lines[1].includes('"Jane ""JD"" Doe"'), "csv quoting works: " + lines[1]);
});

check("Markdown export valid", () => {
  const items = [lib.buildItem("CC6.1", BY_ID, { owner: "Jane", targetDate: "2026-10-07", status: "Done" })];
  const md = lib.exportMarkdown(items, BY_ID);
  assert.ok(md.includes("# SOC 2 Remediation Plan"));
  assert.ok(md.includes("CC6.1"));
  assert.ok(md.includes("Progress: 1 of 1 items done (100%)"));
  assert.ok(md.includes("Readiness aid only"));
  assert.ok(!md.includes("\u2014"), "no em dashes in markdown export");
});

check("no em dashes in user-facing source files", () => {
  ["index.html", "app.js", "README.md"].forEach((f) => {
    const t = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!t.includes("\u2014"), f + " contains an em dash");
  });
});

check("disclaimer present in index.html", () => {
  const t = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.ok(t.includes("Readiness aid only. Not an audit, attestation, CPA opinion, or legal advice."));
});

check("lead capture: REPORT_INBOX set, mailto builder, and validation", () => {
  assert.ok(lib.REPORT_INBOX.length > 0, "REPORT_INBOX empty");
  assert.ok(lib.isValidEmail("neo@aitechpros.ai"));
  assert.ok(!lib.isValidEmail("not-an-email"));
  assert.ok(!lib.isValidEmail(""));
  const url = lib.leadMailto(lib.REPORT_INBOX, "Subject here", "Body here");
  assert.ok(url.startsWith("mailto:" + lib.REPORT_INBOX + "?subject="), "mailto prefix wrong");
  assert.ok(url.includes("body="), "mailto missing body");
  assert.ok(!url.includes("formsubmit"), "FormSubmit reference remains");
});

check("lead capture: subject and body carry email, company, counts, and critical items", () => {
  const items = [
    lib.buildItem("CC6.1", BY_ID),
    lib.buildItem("CC1.1", BY_ID, { status: "Done" })
  ];
  const subject = lib.buildLeadSubject("Acme");
  assert.ok(subject.includes("Acme"), "subject missing company");
  const body = lib.buildLeadBody("neo@aitechpros.ai", "Acme", items, BY_ID);
  assert.ok(body.includes("neo@aitechpros.ai"), "body missing visitor email");
  assert.ok(body.includes("Acme"), "body missing company");
  assert.ok(body.includes("2"), "body missing item count");
  assert.ok(body.includes("CC6.1"), "body missing open critical item");
  assert.ok(!body.includes("CC1.1"), "done item should not be listed as open critical");
});

check("lead capture: form fields and privacy copy in index.html", () => {
  const t = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.ok(t.includes('id="leadForm"'), "leadForm missing");
  assert.ok(t.includes('id="leadEmail"'), "leadEmail missing");
  assert.ok(t.includes("No spam, ever. We never sell your information."), "privacy copy missing");
});

check("lead capture: styles exist", () => {
  const t = fs.readFileSync(path.join(dir, "styles.css"), "utf8");
  assert.ok(t.includes(".lead-form"), "lead-form styles missing");
});

console.log("\n" + pass + " checks passed.");
