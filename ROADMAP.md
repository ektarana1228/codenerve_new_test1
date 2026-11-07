# ApexCoder — Commercialization Roadmap

Domain: apexcoder.io. Invite emails sent from assessment@apexcoder.io.

## Launch scope (decided 2026-07-11)

Needed before taking the first paying customer:

- Production hosting on Railway or Render, DNS pointed at apexcoder.io
- Transactional email via Resend (SPF/DKIM/DMARC verified for apexcoder.io)
- Billing via Stripe Checkout
- ToS + Privacy Policy
- Basic uptime/error monitoring

## Full backlog (no longer gated on customer demand)

Not yet sequenced or started:

1. Code-quality / complexity scoring (e.g. `radon` for Python, ESLint complexity rule for JS/TS)
2. Whiteboard mode (live-interview canvas)
3. Additional languages beyond Python/JS/TS
4. ATS/HRIS integrations (per-integration OAuth app + ongoing maintenance)
5. Proctoring / identity verification (requires a paid third-party vendor SDK — per-check cost, not just build effort)
6. SOC 2 / ISO 27001 / bias-audit compliance — **not code-buildable.** Requires engaging a paid external auditor. The only in-repo work possible is supporting technical controls (access logging, encryption at rest, audit trails).

## Flagged, not yet acted on

- Some jurisdictions (e.g. NYC Local Law 144) require a bias audit for automated employment-decision tools before commercial use — review before signing the first contract.
