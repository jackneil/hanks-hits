// Railway Infrastructure as Code for the Hank's Hits web app.
// https://docs.railway.com/infrastructure-as-code
//
// STATUS: PREPARED, NOT APPLIED. railway.toml (Config as Code) still sets the
// deploy settings. Railway reads railway.toml during every deploy and never
// reads this folder. Railway stops reading railway.toml on 2026-12-01, so do
// the one-time migration in .railway/README.md before that date.
//
// WARNING: `railway config apply` makes the service match this file.
// - A variable that is not in `env` is DELETED from the service.
// - Without `source`, the service is detached from the repository and
//   auto-deploy stops.
// - Without the `partial` export, an apply deletes every resource in the
//   project that this file does not declare (Postgres, webserver, url-cache
//   and the backup bucket).
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
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    // Every variable that the service has on Railway, and every variable
    // that the app reads in production. preserve() keeps the value that
    // Railway holds, so no value is written into this repository.
    //
    // NEVER add CLIPS_LAB here, in any form: the clips lab page (/clips-lab)
    // answers 404 in production only because that variable is not set.
    env: {
      AUTH_GOOGLE_ID: preserve(),
      AUTH_GOOGLE_SECRET: preserve(),
      AUTH_SECRET: preserve(),
      AUTH_URL: preserve(),
      // Gameplay clips (GET /api/clips-config). Not set on Railway on
      // 2026-09-29, so production has clips off (the production default)
      // and no dogfood players. They are here so that the dogfood step can
      // set them in the dashboard and a later apply keeps them. Without them
      // an apply would delete them, and every dogfood browser would lose
      // capture at its next page load with no error anywhere.
      CLIPS_DOGFOOD_USER_IDS: preserve(),
      CLIPS_MODE: preserve(),
      DATABASE_URL: preserve(),
      NEXT_PUBLIC_ROM_CDN_URL: preserve(),
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
