// Railway Infrastructure as Code for the Hank's Hits web app.
//
// This file replaces railway.toml (Config as Code). Railway stops reading
// Config as Code files on 2026-12-01.
// https://docs.railway.com/infrastructure-as-code
//
// Railway does not read this file during a deploy. The settings go live only
// when you run `railway config apply`. Read .railway/README.md first.
//
// The file is a named partial: it manages the "hanks-garage" service only.
// The other resources in the project (Postgres, webserver, url-cache and the
// backup bucket) stay as they are. Without the partial export, an apply would
// delete every resource that this file does not declare.

import { defineRailway, project, service } from "railway/iac";

export const partial = "hanks-garage";

export default defineRailway(() => {
  const web = service("hanks-garage", {
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
  });

  return project("hanks-hits", {
    resources: [web],
  });
});
