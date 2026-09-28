import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { SITE } from "@/config/site";
import type { LegalContact } from "@/config/legal";

import { PrivacyNotice } from "../components/PrivacyNotice";
import {
  INACTIVE_ACCOUNT_MONTHS,
  KID_SUMMARY,
  KID_TEXT_LABELS,
  NOTICE_SECTIONS,
  PRIVACY_NOTICE_UPDATED,
  formatNoticeDate,
} from "../lib/notice";
import PrivacyRoute from "@/app/privacy/page";

const FILLED: LegalContact = {
  operatorName: "Example Games LLC",
  mailingAddress: "PO Box 123\nSpringfield, ST 00000",
  phone: "(555) 555-0123",
  email: "privacy@example.com",
};

/** Escape a string for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SITE_NAME = escapeRegExp(SITE.name);

const EMPTY: LegalContact = {
  operatorName: "",
  mailingAddress: "",
  phone: "",
  email: "",
};

describe("PrivacyNotice", () => {
  afterEach(() => {
    removeSpeechMock();
  });

  describe("kid summary", () => {
    beforeEach(() => {
      installSpeechMock();
    });

    it("shows every kid line before the grown-up notice", () => {
      render(<PrivacyNotice contact={FILLED} />);

      const kids = screen.getByRole("region", { name: "For kids: what we save" });
      for (const line of KID_SUMMARY) {
        expect(within(kids).getByText(line.text)).toBeInTheDocument();
      }

      const grownUps = screen.getByRole("article", {
        name: "For grown-ups: the full notice",
      });
      // The kid part comes first in the page.
      expect(
        kids.compareDocumentPosition(grownUps) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("reads the kid summary out loud, without the emoji", () => {
      const speech = installSpeechMock();
      render(<PrivacyNotice contact={FILLED} />);

      const kids = screen.getByRole("region", { name: "For kids: what we save" });
      fireEvent.click(within(kids).getByTestId("read-aloud-button"));

      expect(speech.speak).toHaveBeenCalledTimes(1);
      const spoken = speech.lastUtterance().text;
      for (const line of KID_SUMMARY) {
        expect(spoken).toContain(line.text);
        expect(spoken).not.toContain(line.emoji);
      }
    });

    it("gives the read-aloud button a big touch target", () => {
      render(<PrivacyNotice contact={FILLED} />);
      expect(screen.getByTestId("read-aloud-button").className).toMatch(
        /min-h-\[56px\]/
      );
    });
  });

  describe("operator contact", () => {
    it("shows every contact field when legal.json is filled", () => {
      render(<PrivacyNotice contact={FILLED} />);

      const contact = screen.getByTestId("operator-contact");
      expect(within(contact).getByText("Example Games LLC")).toBeInTheDocument();
      expect(within(contact).getByText("PO Box 123")).toBeInTheDocument();
      expect(within(contact).getByText("Springfield, ST 00000")).toBeInTheDocument();

      const phone = within(contact).getByRole("link", { name: "(555) 555-0123" });
      expect(phone).toHaveAttribute("href", "tel:5555550123");

      const email = within(contact).getByRole("link", { name: "privacy@example.com" });
      expect(email).toHaveAttribute("href", "mailto:privacy@example.com");

      expect(within(contact).queryByText("Coming soon")).not.toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`^Example Games LLC runs ${SITE_NAME}\\.`))
      ).toBeInTheDocument();
    });

    it("says Coming soon, with no dead links, while legal.json is empty", () => {
      render(<PrivacyNotice contact={EMPTY} />);

      const contact = screen.getByTestId("operator-contact");
      expect(within(contact).getAllByText("Coming soon")).toHaveLength(4);
      expect(within(contact).queryAllByRole("link")).toHaveLength(0);
      expect(
        screen.getByText(new RegExp(`^Contact the operator of ${SITE_NAME} with any question`))
      ).toBeInTheDocument();
    });

    it("renders the real route with today's legal.json (filled values: PrivacyRoute.test.tsx)", () => {
      render(<PrivacyRoute />);
      expect(screen.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeInTheDocument();
      expect(screen.getByTestId("operator-contact")).toBeInTheDocument();
    });
  });

  describe("COPPA 312.4(d) and 312.10 content", () => {
    it("has a heading for every section of the notice", () => {
      render(<PrivacyNotice contact={FILLED} />);
      for (const section of NOTICE_SECTIONS) {
        const heading = screen.getByRole("heading", { level: 3, name: section.title });
        expect(heading.closest("section")).toHaveAttribute("id", section.id);
      }
    });

    it("gives every kind of data a use, an audience and a retention time", () => {
      render(<PrivacyNotice contact={FILLED} />);

      const kinds = document.querySelectorAll("#collect article");
      expect(kinds.length).toBeGreaterThanOrEqual(8);
      for (const kind of Array.from(kinds)) {
        const labels = Array.from(kind.querySelectorAll("dt")).map((dt) => dt.textContent);
        expect(labels).toEqual([
          "What we collect",
          "How we use it",
          "Who can see it",
          "How long we keep it",
        ]);
        for (const dd of Array.from(kind.querySelectorAll("dd"))) {
          expect(dd.textContent?.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("names every company that gets information", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const sharing = document.getElementById("sharing")!;
      for (const company of [
        "Railway",
        "Cloudflare",
        "Google",
        "Open-Meteo",
        "icanhazdadjoke.com",
        "EmulatorJS",
      ]) {
        expect(sharing.textContent).toContain(company);
      }
    });

    it("says that nothing is sold, and whether a child can make information public", () => {
      render(<PrivacyNotice contact={FILLED} />);
      expect(document.getElementById("never")!.textContent).toMatch(
        /never sell or rent information/
      );
      expect(document.getElementById("public")!.textContent).toMatch(
        /Nothing that a player types appears on a leaderboard/
      );
    });

    it("states the parental rights and how to use them", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const rights = document.getElementById("rights")!;
      expect(rights.textContent).toMatch(/See the information that we have about your child/);
      expect(rights.textContent).toMatch(/Tell us to delete/);
      expect(rights.textContent).toMatch(/Tell us to stop collecting and using/);
      expect(within(rights).getByRole("heading", { name: "How to ask" })).toBeInTheDocument();
      expect(rights.textContent).toMatch(/make sure that the request comes from the child's parent/);
    });

    it("states the internal operations for persistent identifiers (312.4(d)(3))", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const identifiers = document.getElementById("identifiers")!;
      expect(identifiers.textContent).toMatch(/We use them only to run the site/);
      expect(identifiers.textContent).toMatch(
        /do not use them to contact a person, to show ads, or to build a profile/
      );
      // 312.4(d)(3) also requires the means that keep the promise.
      expect(identifiers.textContent).toMatch(/This is how we make sure of it\./);
      expect(identifiers.textContent).toMatch(/no ad code, and no code that follows a person to other websites/);
      expect(identifiers.textContent).toMatch(/no way to send messages to players/);
      expect(identifiers.textContent).toMatch(
        /Only the operator and the companies in "Companies that help us run the site" get these identifiers/
      );
    });

    it("gives a deletion timeframe for account data (312.10), from the same number the delete job uses", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const deletion = document.getElementById("deletion")!;
      expect(deletion.textContent).toContain(
        `We delete an account when nobody uses it for ${INACTIVE_ACCOUNT_MONTHS} months.`
      );
      // The same kinds of use that lib/account-retention.ts checks.
      expect(deletion.textContent).toMatch(
        /saves progress[\s\S]*score to a leaderboard[\s\S]*the account, its name or its leaderboard setting changes/
      );
      expect(deletion.textContent).toMatch(/count from the date that the account was made/);
      expect(deletion.textContent).toMatch(/every day/);

      // No kind of account data says "until deleted" without the timeframe.
      for (const id of ["account", "progress", "leaderboards"]) {
        const keep = document.getElementById(id)!.textContent!;
        expect(keep).toContain(`nobody uses it for ${INACTIVE_ACCOUNT_MONTHS} months`);
      }
    });

    it("lists every game that saves player text, and says guest progress can move into the account", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const progress = document.getElementById("progress")!;
      const items = Array.from(progress.querySelectorAll("li")).map((li) => li.textContent ?? "");
      for (const label of Object.values(KID_TEXT_LABELS)) {
        expect(items.some((item) => item.startsWith(`${label}:`)), label).toBe(true);
      }
      expect(progress.textContent).toMatch(/What is your name, wagon leader\?/);
      expect(progress.textContent).toMatch(/names that the player gives to the animal feeders/);
      expect(progress.textContent).toMatch(
        /When the player later signs in on that device, the games can copy that progress into the account/
      );
      expect(progress.textContent).not.toMatch(/It does not come to our server/);
    });

    it("says where the hand-made backup copies are, and how long deleted data stays in them", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const backups = document.getElementById("backups")!.textContent!;
      expect(backups).toMatch(/Railway stores the automatic backups/);
      expect(backups).toMatch(/on Railway, or on the operator's own computer/);
      expect(backups).toMatch(/Information that we delete can stay in these copies until then/);
    });

    it("does not say that error logs hold emails, names or passwords", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const network = document.getElementById("network")!.textContent!;
      expect(network).not.toMatch(/can also include the data that the site tried to save/);
      expect(network).toMatch(/They do not include email addresses, names, passwords/);
      expect(network).toMatch(/Railway can store them for longer under its own rules/);
      const statistics = document.getElementById("statistics")!.textContent!;
      expect(statistics).toMatch(/We can see the sample for 6 months/);
    });

    it("shows the last-updated date", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const date = formatNoticeDate(PRIVACY_NOTICE_UPDATED);
      expect(date).toBe("September 28, 2026");
      expect(screen.getAllByText(`Last updated: ${date}`).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("page quality", () => {
    it("uses no em-dashes anywhere on the page", () => {
      const { container } = render(<PrivacyNotice contact={FILLED} />);
      expect(container.textContent).not.toContain(String.fromCharCode(0x2014));
      // An en-dash is not a prose dash either.
      expect(container.textContent).not.toContain(String.fromCharCode(0x2013));
    });

    it("points every jump link at a section that exists", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const nav = screen.getByRole("navigation", { name: "Jump to a part of the notice" });
      const links = within(nav).getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const target = link.getAttribute("href")!;
        expect(target.startsWith("#")).toBe(true);
        expect(document.getElementById(target.slice(1))).not.toBeNull();
        expect(link.className).toMatch(/min-h-\[44px\]/);
      }
    });

    it("links only to itself, the phone and the email (no links to the open internet)", () => {
      render(<PrivacyNotice contact={FILLED} />);
      const main = screen.getByRole("main");
      for (const link of within(main).getAllByRole("link")) {
        const href = link.getAttribute("href") ?? "";
        expect(href).toMatch(/^(#|tel:|mailto:)/);
      }
    });
  });
});
