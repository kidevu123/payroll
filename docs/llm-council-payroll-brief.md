# LLM Council brief — Milo payroll platform

Use this prompt with the **llm-council** skill (`python3 ~/.cursor/skills/llm-council/scripts/query_llms.py "$(cat docs/llm-council-payroll-brief.md)"`).

## System summary

Self-hosted Next.js 15 payroll for a small manufacturing/distribution business (~LX120 Proxmox). Postgres + Drizzle, Auth.js, pg-boss jobs, Playwright NGTeco scrape (no API), integer-cents pay math, en/es i18n.

**Core loop:** NGTeco poll every 15m → punch pairing/import → missed-punch detection → employee fix window → admin approve → Sunday payroll run → publish payslips → optional Zoho push.

**Recent UX focus:** Missed-punch flows only ask for the missing side (in OR out). Admin calendar pending rail shows on-file vs employee-proposed times. Admin punch editor prioritizes closing open shifts over add-manual-punch.

## Ask the council

1. **Architecture risks** — single-tenant LXC, pg-boss, Playwright scraper, no Redis. What fails at scale or under partial NGTeco outage?

2. **Hall monitor completeness** — We added weekly checks: poll health, open shifts, duplicate clusters, detectExceptions for Sun–Sat, payslip vs computePay drift, pending requests, missing NGTeco refs. What else must an *outside verifier* check before payroll lock?

3. **Trust boundaries** — Employee-submitted clock times vs fingerprint punches. How should approval UX and audit trail minimize duplicate/wrong pay?

4. **Operational runbook** — Owner runs payroll in <5 min/week. Prioritize automations vs manual gates.

5. **Testing gaps** — Pure functions in lib/payroll and lib/punches are tested; E2E is thin. Highest-ROI test additions?

Respond with prioritized recommendations (P0/P1/P2), not generic advice.
