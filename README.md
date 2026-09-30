# SOC 2 Remediation Plan Generator

Turn readiness gaps into a sequenced, owner-assigned remediation plan.

## What it does

- **Import gaps** from the SOC 2 Readiness Calculator (reads its `soc2calc` localStorage data), or add any of the 61 Trust Services Criteria manually with category, priority, and text filters.
- **Auto-prioritized plan**: critical-priority criteria first, then Security before optional categories, each with suggested evidence, an editable owner, an editable target date (staggered weekly by default), notes, and status (Not started / In progress / Done).
- **Reorder** items with Up/Down buttons, add custom action items not tied to a criterion, and remove items.
- **Progress bar** tracks % done.
- **Exports**: CSV download and Markdown plan download.
- Plan persists in the browser under localStorage key `soc2remed`. No backend, no tracking.

## Dataset

Uses the machine-readable Trust Services Criteria dataset (`data/tsc.json`): 61 criteria across Security (33, mandatory Common Criteria), Availability (3), Processing Integrity (5), Confidentiality (2), and Privacy (18). Source: AICPA 2017 Trust Services Criteria (TSP Section 100) with 2022 revised points of focus. Summaries and evidence suggestions are original plain-English guidance.

Upstream dataset repo: https://github.com/nehemiah313/tsc-dataset

## Run locally

Serve over HTTP (fetch does not work from `file://`):

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/

## Disclaimer

Readiness aid only. Not an audit, attestation, CPA opinion, or legal advice.

## License

MIT. See LICENSE.

## Lead capture

At the top of the pure-logic section in `app.js`:

```js
const REPORT_INBOX = "n.harvard@aitechpros.ai";
```

When set, a "Get your plan reviewed" form appears under the remediation plan. The visitor enters their work email (and optional company); their full plan downloads immediately, and their mail app opens with a pre-addressed review request to the inbox carrying a plan summary (company, email, item counts, open critical items). The visitor hits Send in their own mail app, so the lead arrives from their real address with no backend service involved. The visitor's email and company are remembered in localStorage (`soc2remedlead`) so returning visitors do not retype them. Set the constant to `""` to hide the form entirely.

Privacy copy on the page states the review request goes to AI Tech Pros for follow-up and that the address is never sold.
