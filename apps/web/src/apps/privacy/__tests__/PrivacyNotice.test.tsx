import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { LEGAL_NOTICE_CONFIG, type PrivacyNoticeConfig } from "@/config/legal";
import { HIDDEN_KEEP_DAYS, PUBLIC_KEEP_MONTHS, UPLOAD_LEDGER_KEEP_MS } from "@/lib/leaderboard-clips/retention";
import { PrivacyNotice } from "../components/PrivacyNotice";
import { KID_SUMMARY, NOTICE_SECTIONS, PLAYER_SAVE_DETAILS } from "../lib/notice";

// Synthetic review fixture. These are not the real operator or a selected policy.
const REVIEWED: PrivacyNoticeConfig = {
  publicationEnabled: true,
  operatorName: "Test Adult",
  mailingAddress: "Test address line 1\nTest address line 2",
  phone: "(555) 555-0123",
  email: "review@example.com",
  adultContactVerified: true,
  requestProcess: "Test-only reviewed request process.",
  requestProcessVerified: true,
  coverageAssessment: "other_reviewed",
  clipStorageProvider: "Test Storage",
  clipStorageProviderVerified: true,
  retentionDetails: "Test-only reviewed retention details.",
  retentionDetailsVerified: true,
};

function section(id: string): HTMLElement {
  return document.getElementById(id)!;
}

afterEach(() => removeSpeechMock());

describe("privacy notice draft", () => {
  it("clearly labels an incomplete local preview and creates no missing-contact links", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    expect(screen.getByRole("complementary", { name: "Unpublished draft" })).toBeInTheDocument();
    const contact = screen.getByTestId("operator-contact");
    expect(within(contact).getAllByText("Not supplied for this draft")).toHaveLength(4);
    expect(within(contact).queryAllByRole("link")).toHaveLength(0);
    expect(section("requests")).toHaveTextContent("promises no response deadline");
  });

  it.each([undefined, false])("renders no incomplete notice with preview=%s", (preview) => {
    const { container } = render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview={preview} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every kid line before the grown-up explanation", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    const kids = screen.getByRole("region", { name: "For kids: what we save" });
    const grownUps = screen.getByRole("article", { name: "For grown-ups: how the site saves information" });
    for (const line of KID_SUMMARY) expect(within(kids).getByText(line.text)).toBeInTheDocument();
    expect(kids.compareDocumentPosition(grownUps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads the actual kid summary on demand without emoji", () => {
    const speech = installSpeechMock();
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    fireEvent.click(screen.getByRole("button", { name: "Read it to me" }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    for (const line of KID_SUMMARY) {
      expect(speech.lastUtterance().text).toContain(line.text);
      expect(speech.lastUtterance().text).not.toContain(line.emoji);
    }
  });

  it("points every jump link at the matching visible section", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    const nav = screen.getByRole("navigation", { name: "Jump to a part of this page" });
    for (const entry of NOTICE_SECTIONS) {
      expect(within(nav).getByRole("link", { name: entry.navLabel })).toHaveAttribute("href", `#${entry.id}`);
      expect(within(section(entry.id)).getByRole("heading", { name: entry.title })).toBeInTheDocument();
    }
  });

  it("describes the confirmed project, cloud words and drawings, and retained sign-out recovery", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    expect(section("about")).toHaveTextContent("personal games and apps project");
    expect(section("about")).toHaveTextContent("does not earn revenue at this time");
    expect(section("accounts")).toHaveTextContent("An account is optional");
    for (const line of PLAYER_SAVE_DETAILS) expect(within(section("progress")).getByText(line)).toBeInTheDocument();
    expect(section("progress")).toHaveTextContent("not all device-only today");
    expect(section("progress")).toHaveTextContent("preserves local save partitions and recovery originals");
    expect(section("retro")).toHaveTextContent("not included in normal cloud progress");
    expect(section("retro")).toHaveTextContent("Older saved copies");
  });

  it("distinguishes device clips, public posts and game audio from microphone/camera input", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    expect(section("public")).toHaveTextContent("stored in the browser on your device");
    expect(section("public")).toHaveTextContent("Other visitors can watch the posted video");
    expect(section("public")).toHaveTextContent("Anything visible in the game picture");
    expect(section("public")).toHaveTextContent("does not use the device microphone or camera");
    expect(section("public")).not.toHaveTextContent("Players cannot post");
    expect(section("public")).not.toHaveTextContent("only the leaderboards");
  });

  it("uses current clip cutoffs as qualified settings, including failure and hold limits", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    expect(section("public")).toHaveTextContent(`older than ${PUBLIC_KEEP_MONTHS} months`);
    expect(section("public")).toHaveTextContent(`more than ${HIDDEN_KEEP_DAYS} days`);
    expect(section("public")).toHaveTextContent(`threshold of ${UPLOAD_LEDGER_KEEP_MS / 86_400_000} days`);
    expect(section("public")).toHaveTextContent("Storage failures can delay cleanup");
    expect(section("public")).toHaveTextContent("separate from routine clip cleanup");
    expect(section("public")).toHaveTextContent("not a guarantee about every copy");
  });

  it("does not invent account deletion, backup expiry, provider identity or a support deadline", () => {
    render(<PrivacyNotice config={LEGAL_NOTICE_CONFIG} preview />);
    expect(section("deletion")).toHaveTextContent("does not currently delete whole accounts automatically");
    expect(section("deletion")).toHaveTextContent("no self-service account deletion button");
    expect(section("deletion")).toHaveTextContent("does not delete information already saved");
    expect(section("sharing")).toHaveTextContent("deployed provider still needs confirmation");
    expect(section("sharing")).not.toHaveTextContent("Amazon");
    expect(document.body).not.toHaveTextContent("We answer within 30 days");
    expect(document.body).not.toHaveTextContent("24 months");
    expect(document.body).not.toHaveTextContent("90 days");
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("keeps supplied reviewed contact links and policies in their own sections", () => {
    render(<PrivacyNotice config={REVIEWED} preview={false} />);
    const contact = screen.getByTestId("operator-contact");
    expect(within(contact).getByText("Test Adult")).toBeInTheDocument();
    expect(within(contact).getByText("Test address line 2")).toBeInTheDocument();
    expect(within(contact).getByRole("link", { name: REVIEWED.phone })).toHaveAttribute("href", "tel:5555550123");
    expect(within(contact).getByRole("link", { name: REVIEWED.email })).toHaveAttribute("href", "mailto:review@example.com");
    expect(section("requests")).toHaveTextContent(REVIEWED.requestProcess);
    expect(section("deletion")).toHaveTextContent(REVIEWED.retentionDetails);
    expect(screen.queryByRole("complementary", { name: "Unpublished draft" })).not.toBeInTheDocument();
  });

  it("does not show incomplete optional address or phone rows after reviewed non-COPPA coverage", () => {
    render(<PrivacyNotice config={{ ...REVIEWED, mailingAddress: "", phone: "" }} preview={false} />);
    const contact = screen.getByTestId("operator-contact");
    expect(within(contact).queryByText("Mailing address")).not.toBeInTheDocument();
    expect(within(contact).queryByText("Phone")).not.toBeInTheDocument();
    expect(within(contact).queryByText("Not supplied for this draft")).not.toBeInTheDocument();
  });

  it.each([
    ["(555) 555-0123 ext. 456", "tel:5555550123;ext=456"],
    ["+1 (555) 555-0123 x456", "tel:+15555550123;ext=456"],
    ["555-555-0123;ext=456", "tel:5555550123;ext=456"],
  ])("keeps the extension separate when dialing %s", (phone, href) => {
    render(<PrivacyNotice config={{ ...REVIEWED, phone }} />);
    expect(within(screen.getByTestId("operator-contact")).getByRole("link", { name: phone }))
      .toHaveAttribute("href", href);
  });

  it("keeps an unfamiliar phone format as text rather than inventing a dial target", () => {
    const phone = "555-555-0123 (ask for review desk)";
    render(<PrivacyNotice config={{ ...REVIEWED, phone }} />);
    const contact = screen.getByTestId("operator-contact");
    expect(within(contact).getByText(phone)).toBeInTheDocument();
    expect(within(contact).queryByRole("link", { name: phone })).not.toBeInTheDocument();
  });
});
