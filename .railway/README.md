# Railway configuration

This folder holds the Railway Infrastructure as Code (IaC) file for the
Hank's Hits web app: `railway.ts`. It is the only source of the build and
deploy settings of the `hanks-garage` service.

Reference: https://docs.railway.com/infrastructure-as-code

## Status

- `railway.ts` is applied. `railway config apply` ran on 2026-10-02, before
  the change that deleted `railway.toml` merged. The pull request of that
  change records the apply. Do not merge such a change before the apply: a
  deploy without `railway.toml` and without the apply uses the dashboard
  values, and these values have no healthcheck (see "History").
- The repository has no Config as Code file (`railway.toml` or
  `railway.json`). `platform-config.test.ts` fails if one of these files
  comes back.
- Railway does not read this folder during a deploy. A change to
  `railway.ts` has no effect until you run `railway config apply`.

## Warnings

- `railway config apply` changes production. Get approval before you run it.
- Apply only when `railway config plan` shows `0 to destroy`. To remove a
  variable on purpose, delete it in the dashboard first (this also needs
  approval), then plan again.
- Do not add a `railway.toml` or `railway.json` file to the repository.
  Railway reads such a file during every deploy, and its values override the
  values that an apply set from `railway.ts`.
- Keep the config file path field empty in the Settings of the
  `hanks-garage` service. A value there makes Railway read a Config as Code
  file again.
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
| Restart policy | On failure (the Railway default, so `railway.ts` does not declare it) |
| Maximum restart retries | 3 |
| Variables | `CLIPS_MODE` (set to `on` on 2026-10-01), `CLIPS_DOGFOOD_USER_IDS` (not set) and the 9 other variables that Railway holds, each kept with `preserve()`. Before clips, Railway held 10 variables. The tenth, `NEXT_PUBLIC_ROM_CDN_URL`, was deleted on 2026-10-02. |

`platform-config.test.ts` checks these values. If you change a value in
`railway.ts`, change the test in the same change.

## Variables that are not Railway variables

- `NEXT_PUBLIC_ROM_CDN_URL`: The app reads this name, but Next.js puts its
  value into the bundle at build time. The value comes from
  `apps/web/.env.production` (`/api/roms`). The Dockerfile passes no build
  argument for it, so a Railway variable with this name has no effect. The
  dead Railway variable was deleted on 2026-10-02, after the apply. Do not
  declare this name in `railway.ts`.
- The same rule applies to each `NEXT_PUBLIC_` name in
  `apps/web/.env.production`. `platform-config.test.ts` fails if `railway.ts`
  declares one of these names, or if the Dockerfile gives one of them an
  `ARG` or `ENV` line. It also fails if `railway.ts` declares a
  `NEXT_PUBLIC_` variable that has no `ARG` line in the Dockerfile.
- `CLIPS_LAB`: never a Railway variable (see "Warnings").

## Preview and apply a change

1. From the repository root, install the dependencies: `pnpm install`.
   The `railway` package gives the `railway/iac` import.
2. Link the folder to the project: `railway link`. Select the project
   `hanks-hits`, the environment `production` and the service `hanks-garage`.
   The link is a local setting of the Railway CLI (`~/.railway/config.json`)
   for each folder. It changes nothing on Railway. A new git worktree is not
   linked, so run `railway link` in the worktree too.
3. Commit your change to `railway.ts`. The plan file of step 4 records the
   `.railway/` tree of the commit (`git rev-parse HEAD:.railway`). The apply
   of step 6 fails if the checked-out `.railway/` tree is a different tree.
4. Preview the change and save it:
   `railway config plan --out /tmp/hanks-garage.plan`. This command only
   reads Railway. It writes only the local plan file.
5. Examine the plan. Continue only if all of these are true:
   - The plan shows `0 to add` and `0 to destroy`.
   - The plan changes only `service.hanks-garage`.
   - The plan changes only the settings that your change to `railway.ts`
     changes. With no change, the plan says that the configuration is
     already up to date.
   - Do not declare a setting at its Railway default value (for example,
     `restartPolicyType: "ON_FAILURE"`). Railway does not store a default
     value, so the plan shows that line as a change on every run, and an
     apply cannot remove it (see "History").
   - The plan does not change the source or a domain, and it does not
     replace the service.

   If one of these is false, do not apply. Correct `railway.ts` and plan
   again. For example, if the plan changes the source, make sure that the
   service has `source: github("jackneil/hanks-hits", { branch: "master" })`.
   In a copy of this repository for a different Railway project, the source
   must be your own repository, not `jackneil/hanks-hits`.
6. Apply the plan that you examined:
   `railway config apply --plan /tmp/hanks-garage.plan`. The apply uses the
   saved change set and does not evaluate `railway.ts` again. It fails if
   the environment changed after step 4 (for example, a variable that
   somebody added in the dashboard). It also fails if the checked-out
   `.railway/` tree is not the planned tree. If it fails, go back to step 4.
   Do not run `railway config apply` without `--plan`. Without `--plan`, the
   apply makes a new plan, and the change that it applies is not
   necessarily the change that you examined in step 5.
7. Read the settings back: run `railway status --json`, or open the service
   Settings in the dashboard. Make sure that the values agree with
   `railway.ts`. Do not trust the exit code of the apply alone.

## Check after the merge

After the first deploy from `master` without `railway.toml`, run
`railway deployment list --service hanks-garage --json`. On the newest
deployment, make sure of these points:

- `meta.configFile` has no value.
- `meta.serviceManifest.build.builder` is `DOCKERFILE`.
- `meta.serviceManifest.deploy` has `healthcheckPath` `/`,
  `healthcheckTimeout` 100 and `restartPolicyMaxRetries` 3. The restart
  policy is `ON_FAILURE` (the default) or has no value.
- The status is `SUCCESS`.

## History

### Before the apply

Until the apply, `railway.toml` (Config as Code) set the build and deploy
settings during every deploy. Railway did not copy these values into the
dashboard. A read-only check on 2026-09-28 showed these dashboard values
for `hanks-garage`:

| Setting | Dashboard value |
| --- | --- |
| Builder | Railpack |
| Dockerfile path | none |
| Healthcheck path | none |
| Healthcheck timeout | none |
| Maximum restart retries | 10 |

A deploy with these values has no healthcheck, so a broken build can go
live. Thus the change that deleted `railway.toml` merged only after the
apply. Railway stops reading `railway.toml` on 2026-12-01.

### Plans and read-back of 2026-10-02

1. Before the apply, a read-only plan of `railway.ts` on `master` showed
   `0 to add, 2 to change, 0 to destroy`. The changes were `build.builder`
   (from no value to `DOCKERFILE`) and four `deploy` fields (from no value
   to `/`, 100, `ON_FAILURE` and 3). The plan changed no variable, domain or
   source. `preserve()` of `CLIPS_DOGFOOD_USER_IDS`, which Railway does not
   hold, gave no change and no error. The service had no config file path,
   so Railway found `railway.toml` at the repository root.
2. Railway recorded two deployments of commit 8187454 from the apply
   (20:26 and 20:28 UTC). Both had an IaC change set as their source.
3. After the apply, a plan of the same file showed
   `0 to add, 1 to change, 0 to destroy`. The one change was
   `deploy.restartPolicyType (null → "ON_FAILURE")`.
4. A read-back of the environment config showed builder `DOCKERFILE`,
   Dockerfile path `Dockerfile`, healthcheck path `/`, healthcheck timeout
   100 and 3 maximum restart retries. It showed no restart policy type. The
   other services of the project also have no restart policy type in the
   environment config, and Railway shows `ON_FAILURE` for each of them.
   ON_FAILURE is the default, and Railway does not store a default value.
   Thus the plan showed this line on every run, until item 7.
5. The plan of the branch that deleted `railway.toml` showed
   `0 to add, 1 to change, 1 to destroy`: the same restart policy line, and
   the deletion of the `NEXT_PUBLIC_ROM_CDN_URL` variable, which that branch
   removed from `env`. This plan was not applied: no deployment followed
   the deployment of 20:28 UTC.
6. The `NEXT_PUBLIC_ROM_CDN_URL` variable was then deleted from Railway. A
   names-only read showed that the service holds 10 variables that are not
   Railway platform variables, all of them in `env`. After that, the plan of
   the same branch showed `0 to add, 1 to change, 0 to destroy`. The one
   change was the restart policy line.
7. The branch then removed `restartPolicyType` from `railway.ts`. The plan
   of the branch then said "Your Railway configuration is already up to
   date": the file and Railway agree, and the service keeps ON_FAILURE as
   the default.
