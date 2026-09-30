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
