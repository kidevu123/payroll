# SSO user mapping (Authentik)

The app's Auth.js `signIn` callback (`lib/auth.ts`) admits an Authentik OIDC
login only when the email Authentik presents exactly matches an existing,
non-disabled payroll user's email. Role and employee linkage always come from
the payroll `users` row — Authentik only proves identity.

## Account mapping (merged 2026-09-01)

| Person       | Payroll user (canonical email) | Authentik username |
| ------------ | ------------------------------ | ------------------ |
| Nabeel       | nabeelvira@gmail.com (OWNER)   | akadmin            |
| Seri         | seri@boomin.com                | seriv              |
| Juan         | juan@gmail.com                 | juanh              |
| Sahil        | sahil@boomin.com               | sahilk             |
| Chintu/Sohan | chintu@gmail.com               | sohanb             |

The Authentik users' emails were set to the payroll emails above (payroll is
the canonical side; several addresses are placeholders, not real mailboxes).

## Adding a new SSO user

1. Create (or locate) the payroll user and note its email.
2. Set the same email on the person's Authentik user (Directory → Users).
3. No app change or restart is needed — matching is evaluated at sign-in.

Authentik instance: LXC 111 on pve (192.168.1.164), issuer
`https://auth.booute.duckdns.org/application/o/payroll/`.
