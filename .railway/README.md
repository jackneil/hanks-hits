# Railway configuration

This folder holds the Railway Infrastructure as Code (IaC) file for the
Hank's Hits web app: `railway.ts`. It replaces `railway.toml` (Config as
Code) at the repository root.

Reference: https://docs.railway.com/infrastructure-as-code

## Status

- `railway.toml` sets the deploy settings now. Railway reads it during every
  deploy, and its values override the dashboard values.
- `railway.ts` is prepared, but nobody has applied it. Railway does not read
  this folder during a deploy. A change to `railway.ts` has no effect until
  you run `railway config apply`.
- Railway stops reading `railway.toml` on 2026-12-01. Do the one-time
  migration below before that date.

## Warnings

- `railway config apply` changes production. Get approval before you run it.
- Apply only when `railway config plan` shows `0 to destroy`.
- An apply deletes every variable of the service that is not in the `env`
  block of `railway.ts`. Before you add a variable in the Railway dashboard,
  add it to `env` with `preserve()`. Also add it to `RAILWAY_VARIABLES` in
  `apps/web/src/__tests__/platform-config.test.ts`.
- Do not remove `source` from the service. Without it, an apply disconnects
  the service from the repository, and merges to master stop deploying.
- Do not remove the `partial` export. Without it, an apply deletes every
  resource in the project that the file does not declare (Postgres,
  webserver, url-cache and the backup bucket).
- Do not write a variable value into `railway.ts`. Use `preserve()`, which
  keeps the value that Railway holds.
- Never add `CLIPS_LAB` to `railway.ts` or to the Railway dashboard. The
  clips lab page (`/clips-lab`) answers 404 in production only because that
  variable is not set.
- `platform-config.test.ts` fails when the app reads a `process.env`
  variable that `railway.ts` does not declare. Add the new variable to
  both files in the same change.

## Settings in the file

The file manages the `hanks-garage` service only:

| Setting | Value |
| --- | --- |
| Source | Repository `jackneil/hanks-hits`, branch `master` |
| Builder | Dockerfile |
| Dockerfile path | `Dockerfile` |
| Healthcheck path | `/` |
| Healthcheck timeout | 100 seconds |
| Restart policy | On failure |
| Maximum restart retries | 3 |
| Variables | The 10 variables that Railway holds, and `CLIPS_MODE` and `CLIPS_DOGFOOD_USER_IDS` (not set yet), each kept with `preserve()` |

The build and deploy values are the same as the values in `railway.toml`.
While both files exist, `platform-config.test.ts` makes sure that they stay
the same. If you change a value, change it in both files.

## Why railway.toml stays until the migration

Railway does not copy the values from `railway.toml` into the dashboard.
If a deploy runs without `railway.toml` before somebody applies `railway.ts`,
that deploy uses the dashboard values. A read-only check on 2026-09-28
showed these dashboard values for `hanks-garage`:

| Setting | Dashboard value |
| --- | --- |
| Builder | Railpack |
| Dockerfile path | none |
| Healthcheck path | none |
| Healthcheck timeout | none |
| Maximum restart retries | 10 |

Such a deploy has no healthcheck, so a broken build can go live. Thus the
removal of `railway.toml` is a separate change that you merge only after the
apply.

## Preview and apply a change

1. From the repository root, install the dependencies: `pnpm install`.
   The `railway` package gives the `railway/iac` import.
2. Link the folder to the project: `railway link`. Select the project
   `hanks-hits`, the environment `production` and the service `hanks-garage`.
3. Preview the change: `railway config plan`. This command only reads.
4. Examine the plan. Continue only if all of these are true:
   - The plan shows `0 to add` and `0 to destroy`.
   - The plan changes only `service.hanks-garage`.
   - The plan changes only `build` and `deploy` fields.
   - The plan does not change the source, a variable or a domain, and it
     does not replace the service.

   If one of these is false, do not apply. Correct `railway.ts` and plan
   again. For example, if the plan changes the source, make sure that the
   service has `source: github("jackneil/hanks-hits", { branch: "master" })`.
5. Apply the change: `railway config apply`.

## One-time migration from railway.toml

Do this before 2026-12-01. It needs approval for a production write.

1. Make a branch from `master`. On the branch, do these edits:
   - Delete `railway.toml`.
   - In `.claude/commands/release.md`, change the reference to `railway.toml`
     to `.railway/railway.ts`.
   - In this README, remove the sections about `railway.toml`.
2. In the Railway dashboard, open the `hanks-garage` service and go to
   Settings. Find the config file path field. If it has a value, clear it.
3. On the branch, run `railway config plan`. Examine the plan as in step 4
   of "Preview and apply a change". A read-only plan of this file on
   2026-09-28 showed `0 to add, 2 to change, 0 to destroy`. The changes were
   `build.builder` and the four `deploy` fields. That plan ran before
   `CLIPS_MODE` and `CLIPS_DOGFOOD_USER_IDS` were in the file, and Railway
   does not hold them yet. Nobody has seen what a plan does with
   `preserve()` for a variable that Railway does not hold. If the plan
   shows a change or an error for either name, do not apply. Ask first.
4. Run `railway config apply`.
5. Read the settings back: run `railway status --json`, or open the service
   Settings in the dashboard. Make sure that the values agree with the table
   in "Settings in the file".
6. Merge the branch.
7. After the first deploy from `master`, run `railway status --json` again.
   Make sure that the new deployment shows no config file and the same
   values.

The Railway docs say that `railway config plan` stops for a service that
`railway.toml` still manages. If the plan in step 3 stops for that reason,
merge the branch first. Then do steps 3, 4 and 5 immediately. Until the
apply, the service uses the dashboard values in the table above.
