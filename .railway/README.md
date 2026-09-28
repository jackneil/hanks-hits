# Railway configuration

This folder holds the Railway Infrastructure as Code (IaC) file for the
Hank's Hits web app: `railway.ts`. This file replaces `railway.toml`
(Config as Code). Railway stops reading Config as Code files on 2026-12-01.

Reference: https://docs.railway.com/infrastructure-as-code

## Warnings

- `railway config apply` changes production. Get approval before you run it.
- Do not remove the `partial` export from `railway.ts`. Without it, an apply
  deletes every resource in the project that the file does not declare
  (Postgres, webserver, url-cache and the backup bucket).
- Railway does not read this folder during a deploy. A change to `railway.ts`
  has no effect until you run `railway config apply`.

## Settings in the file

The file sets these values on the `hanks-garage` service only:

| Setting | Value |
| --- | --- |
| Builder | Dockerfile |
| Dockerfile path | `Dockerfile` |
| Healthcheck path | `/` |
| Healthcheck timeout | 100 seconds |
| Restart policy | On failure |
| Maximum restart retries | 3 |

These are the same values that `railway.toml` had.

## Why the repository has no railway.toml

When `railway.toml` and `.railway/railway.ts` both exist, Railway uses
`railway.toml` during the deploy, and `railway config plan` stops for the
service. The Railway migration procedure removes `railway.toml`. Thus the
repository keeps only `.railway/railway.ts`.

Railway does not copy the values from `railway.toml` into the dashboard.
After the removal, a deploy uses the dashboard values until you apply
`railway.ts`.

## Preview and apply a change

1. From the repository root, install the dependencies: `pnpm install`.
   The `railway` package gives the `railway/iac` import.
2. Link the folder to the project: `railway link`. Select the project
   `hanks-hits`, the environment `production` and the service `hanks-garage`.
3. Preview the change: `railway config plan`. This command only reads.
4. Make sure that the plan changes only `service.hanks-garage`.
5. Apply the change: `railway config apply`.

## One-time move from railway.toml

Do these steps one time, on the branch that removes `railway.toml`,
before you merge it:

1. In the Railway dashboard, open the `hanks-garage` service and go to
   Settings. Find the config file path field. If it has a value, clear it.
2. Run `railway config plan`. The plan must show changes to the build and
   deploy settings of `hanks-garage` only, or no changes.
3. Run `railway config apply`.
4. Merge the branch.

If you merge before the apply, the next deploy uses the dashboard values.
Do the apply immediately to set the values in the table above.
