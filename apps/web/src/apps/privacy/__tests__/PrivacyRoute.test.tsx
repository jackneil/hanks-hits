import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivacyNoticeConfig } from "@/config/legal";

const mocks = vi.hoisted(() => ({
  config: {} as PrivacyNoticeConfig,
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/config/legal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/config/legal")>(),
  LEGAL_NOTICE_CONFIG: mocks.config,
}));

import PrivacyRoute from "@/app/privacy/page";

// Synthetic completed-review fixture. Production config remains empty/disabled.
const COMPLETE: PrivacyNoticeConfig = {
  publicationEnabled: true,
  operatorName: "Test Adult",
  mailingAddress: "",
  phone: "",
  email: "review@example.com",
  adultContactVerified: true,
  requestProcess: "Test reviewed request procedure.",
  requestProcessVerified: true,
  coverageAssessment: "other_reviewed",
  clipStorageProvider: "Test Storage",
  clipStorageProviderVerified: true,
  retentionDetails: "Test reviewed retention details.",
  retentionDetailsVerified: true,
};

beforeEach(() => {
  Object.assign(mocks.config, COMPLETE);
  mocks.notFound.mockClear();
});

describe("/privacy publication boundary", () => {
  it("returns not-found while publication is disabled even with complete contact fields", () => {
    mocks.config.publicationEnabled = false;
    expect(() => PrivacyRoute()).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["operatorName", ""], ["email", ""], ["email", "not-an-email"],
    ["adultContactVerified", false], ["requestProcess", ""],
    ["requestProcessVerified", false], ["coverageAssessment", "pending"],
    ["clipStorageProvider", ""], ["clipStorageProviderVerified", false],
    ["retentionDetails", ""], ["retentionDetailsVerified", false],
  ] as const)("never publishes an enabled but incomplete draft (%s)", (field, value) => {
    Object.assign(mocks.config, { [field]: value });
    expect(() => PrivacyRoute()).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("requires all four operator fields when the assessment says COPPA applies", () => {
    mocks.config.coverageAssessment = "coppa_applies";
    expect(() => PrivacyRoute()).toThrow("NEXT_NOT_FOUND");
  });

  it("renders the notice only after explicit publication and all configured reviews are complete", () => {
    render(PrivacyRoute());
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Privacy at Hank's Hits" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COMPLETE.email })).toHaveAttribute("href", "mailto:review@example.com");
    expect(screen.queryByRole("complementary", { name: "Unpublished draft" })).not.toBeInTheDocument();
    expect(screen.queryByText("Not supplied for this draft")).not.toBeInTheDocument();
  });
});
