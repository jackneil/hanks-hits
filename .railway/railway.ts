// Railway Infrastructure as Code for the Hank's Hits web app.
// https://docs.railway.com/infrastructure-as-code
//
// STATUS: APPLIED on 2026-10-02, before the pull request that deleted
// railway.toml merged (that pull request records the apply). This file is
// the only source of the build and deploy settings of the hanks-garage
// service. Railway does not read this folder during a deploy: a change here
// has no effect until somebody runs `railway config apply` (procedure in
// .railway/README.md).
//
// WARNING: `railway config apply` makes the service match this file.
// - A variable that is not in `env` is DELETED from the service.
// - Without `source`, the service is detached from the repository and
//   auto-deploy stops.
// - Without the `partial` export, an apply deletes every resource in the
//   project that this file does not declare (Postgres, webserver, url-cache
//   and the backup bucket).
// - Never add railway.toml or railway.json to the repository. Railway reads
//   such a file during every deploy, and its values override this file.
// Before you add a variable in the Railway dashboard, add it here with
// preserve(). Apply only when `railway config plan` shows "0 to destroy".

import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "hanks-garage";

export default defineRailway(() => {
  const web = service("hanks-garage", {
    // Deploy the master branch of this repository (auto-deploy on merge).
    source: github("jackneil/hanks-hits", { branch: "master" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      healthcheckPath: "/",
      healthcheckTimeout: 100,
      // No restartPolicyType: the Railway default is ON_FAILURE, and Railway
      // stores no default value (read back on 2026-10-02: null on all 4
      // services, all resolved to ON_FAILURE). Declaring "ON_FAILURE" made
      // every `railway config plan` show a change (null -> "ON_FAILURE") that
      // an apply cannot clear, so a real change hid behind a permanent one.
      // Add the field only to set a value that is not the default.
      restartPolicyMaxRetries: 3,
    },
    // Every variable that the service has on Railway, and every variable
    // that the app reads in production. preserve() keeps the value that
    // Railway holds, so no value is written into this repository.
    //
    // A NEXT_PUBLIC_ name that apps/web/.env.production sets is not here.
    // Next.js puts its value into the bundle at build time from that file,
    // and the Dockerfile passes no build argument, so a Railway variable
    // with that name has no effect. NEXT_PUBLIC_ROM_CDN_URL was such a dead
    // variable. It was deleted from Railway on 2026-10-02, after the apply.
    // platform-config.test.ts fails if this file declares such a name or if
    // the Dockerfile gives it an ARG or ENV line.
    //
    // NEVER add CLIPS_LAB here, in any form: the clips lab page (/clips-lab)
    // answers 404 in production only because that variable is not set.
    env: {
      AUTH_GOOGLE_ID: preserve(),
      AUTH_GOOGLE_SECRET: preserve(),
      AUTH_SECRET: preserve(),
      AUTH_URL: preserve(),
      // Gameplay clips (GET /api/clips-config). Railway holds CLIPS_MODE
      // (set to "on" on 2026-10-01). It does not hold CLIPS_DOGFOOD_USER_IDS,
      // and preserve() of a variable that Railway does not hold changes
      // nothing (plan of 2026-10-02). Both stay here so that an apply keeps
      // them: without them an apply deletes them, and clips go quiet at the
      // next page load with no error anywhere.
      CLIPS_DOGFOOD_USER_IDS: preserve(),
      CLIPS_MODE: preserve(),
      DATABASE_URL: preserve(),
      // Prepared leaderboard-clip variables; enabling/provisioning needs approval.
      ADMIN_USER_IDS: preserve(),
      LEADERBOARD_CLIPS: preserve(),
      LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: preserve(),
      LEADERBOARD_CLIPS_S3_BUCKET: preserve(),
      LEADERBOARD_CLIPS_S3_ENDPOINT: preserve(),
      LEADERBOARD_CLIPS_S3_REGION: preserve(),
      LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: preserve(),
      LEADERBOARD_CLIPS_S3_URL_STYLE: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
    },
  });

  return project("hanks-hits", {
    resources: [web],
  });
});
