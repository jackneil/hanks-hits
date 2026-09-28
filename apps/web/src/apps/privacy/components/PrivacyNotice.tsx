import type { ReactNode } from "react";
import { Header } from "@/shared/components/Header";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { SITE } from "@/config/site";
import type { LegalContact } from "@/config/legal";
import {
  ANALYTICS_FULL_DAYS,
  KID_SUMMARY,
  MANUAL_BACKUP_DAYS,
  PRIVACY_NOTICE_UPDATED,
  SERVER_LOG_DAYS,
  SIGN_IN_COOKIE_DAYS,
  formatNoticeDate,
  kidSummarySpeech,
  sectionNavLabel,
  sectionTitle,
  type NoticeSectionId,
} from "../lib/notice";

/**
 * The privacy notice for /privacy.
 *
 * Part 1 is a short summary for kids, with a read-aloud button.
 * Part 2 is the full notice for parents. It covers every item that COPPA
 * requires in an online notice (16 CFR 312.4(d)) and the written data
 * retention policy (16 CFR 312.10).
 *
 * Every statement must be true for the code that runs today. Read the
 * rules in ../lib/notice.ts before you change a statement.
 */

type Block = string | { items: readonly string[] };

type DataKind = {
  id: string;
  title: string;
  what: readonly Block[];
  use: readonly Block[];
  who: readonly Block[];
  keep: readonly Block[];
};

const DATA_KINDS: readonly DataKind[] = [
  {
    id: "account",
    title: "Account details",
    what: [
      "When a player signs up with an email address, we collect the name that the player types, the email address and a password.",
      "We keep the password only as a scrambled code (a bcrypt hash). Nobody can turn this code back into the password.",
      "When a player uses \"Sign up with Google\" or \"Continue with Google\", Google gives us the name on the Google account, the email address and a link to the profile picture. The name can be a full name.",
      "For a Google sign-in, we also keep the Google account number and the sign-in keys that Google sends.",
      "We record the date that the account was made.",
      "The sign-up page asks a grown-up to make the account, or to give permission first.",
    ],
    use: [
      "We use these details to sign the player in.",
      "We show the name, the email address and the picture only to the signed-in player, on the player's own pages.",
      "We never send email or other messages to players.",
    ],
    who: ["Only the signed-in player and the operator. Other players never see these details."],
    keep: [
      "We keep account details until the account is deleted. A parent can tell us to delete the account at any time (see \"Your rights as a parent\").",
    ],
  },
  {
    id: "progress",
    title: "Game progress",
    what: [
      "When a player is signed in, each game saves its progress on our server. Progress is things like scores, levels, coins, unlocked items and settings.",
      "Some games also save words or pictures that the player makes:",
      {
        items: [
          "Oregon Trail: the names that the player gives the travelers.",
          "Four-Wheeler Adventure 3D: the word on the player's outfit.",
          "Virtual Pet: the name of the pet.",
          "Drawing: the drawings and their names.",
          "Drum Machine: the names of saved beats.",
          "Weather: the places that the player picks, with the town, region, country and map position.",
          "Retro Arcade: saved game spots, and the names of games that the player adds.",
        ],
      },
      "When a player is not signed in, progress stays only in the browser on the device. It does not come to our server.",
    ],
    use: [
      "We use progress so that the player can continue on any device.",
      "We also use it to show the player's stats on the player's profile page.",
    ],
    who: ["Only the signed-in player and the operator."],
    keep: ["We keep game progress until the account is deleted."],
  },
  {
    id: "leaderboards",
    title: "Leaderboard scores",
    what: [
      "For games with a leaderboard, we keep the player's best score, a few game numbers (for example, the biggest tile in 2048) and the date of the score.",
      "We show them next to a player name that the site picks at random, like \"TurboRacer42\". The player cannot choose or type this name.",
    ],
    use: ["We use them to show the leaderboards."],
    who: [
      "Everyone who visits the site. A leaderboard never shows the player's real name, email address or picture.",
    ],
    keep: [
      "We keep leaderboard scores until the account is deleted. A parent can also tell us to hide the player from all leaderboards.",
    ],
  },
  {
    id: "cookies",
    title: "Sign-in cookies",
    what: [
      "When a player signs in, the browser keeps a small file (a cookie). It holds the account number, the name, the email address and the picture link in a locked (encrypted) form.",
      "Some other short-lived cookies protect the sign-in form.",
    ],
    use: ["We use them to keep the player signed in, and to protect the sign-in form from attacks."],
    who: ["Only our server can read them."],
    keep: [
      `The sign-in cookie ends when the player signs out, or ${SIGN_IN_COOKIE_DAYS} days after the player last visited while signed in.`,
      "The other cookies end after 15 minutes, or when the browser closes.",
    ],
  },
  {
    id: "device",
    title: "Information in the browser on the device",
    what: [
      "The browser on the device keeps each game's progress, so the games work without an account.",
      "It also keeps a list of recently played games, a note when a tip is closed, and the account number of the last player who signed in on the device.",
    ],
    use: [
      "We use this information to run the games.",
      "On a shared device, the account number stops one player's progress from going into another player's account.",
    ],
    who: [
      "This information stays on the device. For a signed-in player, games also save progress on our server (see \"Game progress\").",
    ],
    keep: [
      "Signing out removes the progress that belongs to the account from the device.",
      "The other items stay until someone clears the browser's data. Some browsers, like Safari, can clear this data on their own after 7 days with no visit.",
    ],
  },
  {
    id: "network",
    title: "Internet address and browser type",
    what: [
      "Like every website, our server gets the internet (IP) address and the browser type of the visitor with each request.",
    ],
    use: [
      "We use them to stop attacks, and to find and fix errors:",
      {
        items: [
          "We count requests for a short time, to limit how fast requests can come. We count sign-ups and Retro Arcade downloads by internet address, sign-in tries by email address, and game progress requests and name changes by account.",
          "Our hosting company records each request in a server log: the time, the page, the browser type and an internet address.",
          "Our error messages can include an account number. If a sign-up or a save fails with a database error, the error message can also include the data that the site tried to save. This can be an email address, a name, a scrambled password or game progress.",
        ],
      },
    ],
    who: ["Only the operator and our hosting company, Railway."],
    keep: [
      "The counters stay only in the server's memory. We never save them to a disk or a database. The server clears old counters while it runs, and clears all counters when it restarts.",
      `Railway keeps our server logs for ${SERVER_LOG_DAYS} days. We do not copy the logs to any other place.`,
    ],
  },
  {
    id: "statistics",
    title: "Site statistics",
    what: [
      "Cloudflare Web Analytics runs a small script on each page. The script reports the page address (without the part after a \"?\"), the website that linked to the page, the country, the device type, the browser, the operating system and how fast the page loaded.",
      "The script uses no cookies.",
    ],
    use: ["We use the totals to find slow or broken pages, and to count visits."],
    who: [
      "Only the operator, as totals on the Cloudflare dashboard. Cloudflare says that it does not use this data to track visitors across websites.",
    ],
    keep: [
      `Cloudflare keeps the full reports for ${ANALYTICS_FULL_DAYS} days. After that, it keeps only a smaller, combined sample.`,
    ],
  },
  {
    id: "backups",
    title: "Backup copies",
    what: [
      "Copies of our database. The database holds the account details, the game progress and the leaderboard scores that this notice describes.",
    ],
    use: ["We use backups only to bring the site back after a mistake or a failure."],
    who: ["Only the operator. Railway stores the copies."],
    keep: [
      "Railway backs up the database all the time and keeps about 4 weeks of rolling backups. Information that we delete stays in the older backups until they expire, at most about 5 weeks later.",
      `Before a big change to the site, we also make a copy by hand. We delete each copy that we make by hand within ${MANUAL_BACKUP_DAYS} days.`,
    ],
  },
];

const ROW_LABELS: ReadonlyArray<{ key: "what" | "use" | "who" | "keep"; label: string }> = [
  { key: "what", label: "What we collect" },
  { key: "use", label: "How we use it" },
  { key: "who", label: "Who can see it" },
  { key: "keep", label: "How long we keep it" },
];

function BlockList({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        typeof block === "string" ? (
          <p key={index}>{block}</p>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function Section({
  id,
  children,
}: {
  id: NoticeSectionId;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-3">
      <h3 id={`${id}-title`} className="text-2xl font-extrabold text-slate-900">
        {sectionTitle(id)}
      </h3>
      {children}
    </section>
  );
}

const COMING_SOON = "Coming soon";

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function ContactDetails({ contact }: { contact: LegalContact }) {
  const addressLines = contact.mailingAddress
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: ReadonlyArray<{ label: string; value: ReactNode }> = [
    { label: "Operator", value: contact.operatorName || COMING_SOON },
    {
      label: "Mailing address",
      value:
        addressLines.length > 0 ? (
          <address className="not-italic">
            {addressLines.map((line, index) => (
              <span key={index} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          COMING_SOON
        ),
    },
    {
      label: "Phone",
      value: contact.phone ? (
        <a
          href={telHref(contact.phone)}
          className="inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline underline-offset-2"
        >
          {contact.phone}
        </a>
      ) : (
        COMING_SOON
      ),
    },
    {
      label: "Email",
      value: contact.email ? (
        <a
          href={`mailto:${contact.email}`}
          className="inline-flex min-h-[44px] items-center break-all font-semibold text-blue-700 underline underline-offset-2"
        >
          {contact.email}
        </a>
      ) : (
        COMING_SOON
      ),
    },
  ];

  return (
    <dl
      data-testid="operator-contact"
      className="divide-y divide-slate-200 rounded-2xl bg-slate-100 px-5 py-2"
    >
      {rows.map((row) => (
        <div key={row.label} className="py-3 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-6">
          <dt className="font-bold text-slate-900">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DataKindCard({ kind }: { kind: DataKind }) {
  return (
    <article
      id={kind.id}
      aria-labelledby={`${kind.id}-title`}
      className="scroll-mt-24 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:p-5"
    >
      <h4 id={`${kind.id}-title`} className="text-xl font-extrabold text-slate-900">
        {kind.title}
      </h4>
      <dl className="mt-3 divide-y divide-slate-200">
        {ROW_LABELS.map(({ key, label }) => (
          <div key={key} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-6">
            <dt className="font-bold text-slate-900">{label}</dt>
            <dd>
              <BlockList blocks={kind[key]} />
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

const JUMP_LINKS: readonly NoticeSectionId[] = ["operator", "collect", "sharing", "rights"];

interface PrivacyNoticeProps {
  /** Operator contact details (from config/legal.json on the real page). */
  contact: LegalContact;
}

export function PrivacyNotice({ contact }: PrivacyNoticeProps) {
  const updated = formatNoticeDate(PRIVACY_NOTICE_UPDATED);

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />

      <main className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-8">
        <h1 className="text-4xl font-black text-white">Privacy notice</h1>

        {/* Part 1: for kids */}
        <section
          aria-labelledby="kids-title"
          className="rounded-3xl bg-amber-50 p-6 text-slate-900 shadow-xl sm:p-8"
        >
          <h2 id="kids-title" className="text-3xl font-black">
            For kids: what we save
          </h2>
          <ul className="mt-5 space-y-4 text-xl leading-snug">
            {KID_SUMMARY.map((line) => (
              <li key={line.text} className="flex items-start gap-3">
                <span aria-hidden="true" className="w-8 shrink-0 text-2xl leading-none">
                  {line.emoji}
                </span>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
          {/* A string, not a function: this is a server component, and a
              function prop cannot cross into the client button. */}
          <ReadAloudButton text={kidSummarySpeech()} className="mt-6" />
        </section>

        {/* Part 2: for grown-ups */}
        <article
          aria-labelledby="grown-ups-title"
          className="space-y-10 rounded-3xl bg-white p-5 text-base leading-relaxed text-slate-800 shadow-xl sm:p-10"
        >
          <header className="space-y-3">
            <h2 id="grown-ups-title" className="text-3xl font-black text-slate-900">
              For grown-ups: the full notice
            </h2>
            <p className="font-semibold text-slate-700">Last updated: {updated}</p>
            <nav aria-label="Jump to a part of the notice">
              <ul className="flex flex-wrap gap-2">
                {JUMP_LINKS.map((id) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="inline-flex min-h-[44px] items-center rounded-xl bg-slate-100 px-4 font-semibold text-slate-900 hover:bg-slate-200"
                    >
                      {sectionNavLabel(id)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </header>

          <Section id="about">
            <p>
              {`This notice is for parents and guardians. ${SITE.name} is a website of games and apps for children. This notice tells you what information the site collects from children, how we use it, who we share it with and how long we keep it. It also tells you about your rights and how to use them.`}
            </p>
          </Section>

          <Section id="operator">
            <p>
              {contact.operatorName
                ? `${contact.operatorName} runs ${SITE.name}. Contact the operator with any question about this notice or about your child's information.`
                : `Contact the operator of ${SITE.name} with any question about this notice or about your child's information.`}
            </p>
            <ContactDetails contact={contact} />
          </Section>

          <Section id="collect">
            <p>
              {"Each part below tells you what we collect, how we use it, who can see it and how long we keep it. Together, these parts are our written data retention policy."}
            </p>
            <div className="space-y-4">
              {DATA_KINDS.map((kind) => (
                <DataKindCard key={kind.id} kind={kind} />
              ))}
            </div>
          </Section>

          <Section id="public">
            <p>
              {"Other visitors can see only the leaderboards. A leaderboard shows the random player name, the score, a few game numbers and the date."}
            </p>
            <p>
              {"Players cannot post messages, chat, or share anything that other players can see. Nothing that a player types appears on a leaderboard."}
            </p>
          </Section>

          <Section id="never">
            <ul className="list-disc space-y-1 pl-5">
              <li>{"We never sell or rent information about players."}</li>
              <li>{"We never show ads, and we never let ad companies collect information on this site."}</li>
              <li>{"We never send email, text messages or other messages to players."}</li>
              <li>{"We never use information about a child to build a profile of the child, or to follow the child across other websites."}</li>
            </ul>
          </Section>

          <Section id="sharing">
            <p>
              {"We share information only with the companies below, and only so that they can give their service to the site. We also give information to others when the law requires it."}
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Railway (hosting).</strong>{" "}
                {"Railway runs our server and our database. It stores the information that this notice says we keep on our server. It also keeps our server logs and backups."}
              </li>
              <li>
                <strong>Cloudflare (network, security and statistics).</strong>{" "}
                {"All visits to the site go through Cloudflare. Cloudflare gets the internet address of each visitor and the pages that the visitor asks for. It uses them to deliver the pages and to block attacks. It also runs the site statistics. When a page does not load, some browsers send Cloudflare a short error report."}
              </li>
              <li>
                <strong>Google (sign-in).</strong>{" "}
                {"Only for players who sign in with Google. Google gives us the name, the email address and the picture link. The profile picture loads from Google's servers."}
              </li>
            </ul>
            <h4 className="pt-2 text-lg font-extrabold text-slate-900">
              Services that the browser contacts directly
            </h4>
            <p>
              {"Some games and apps get content directly from another service. That service gets the internet address and the browser type of the device."}
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Open-Meteo (weather forecasts).</strong>{" "}
                {"The Weather app sends the place name that the player types, and the map position of the place that the player picks."}
              </li>
              <li>
                <strong>icanhazdadjoke.com (jokes).</strong>{" "}
                {"The Jokes app asks this service for a joke. The app sends nothing that the player types."}
              </li>
              <li>
                <strong>EmulatorJS (Retro Arcade).</strong>{" "}
                {"The Retro Arcade loads its game player program from the EmulatorJS project's servers."}
              </li>
            </ul>
          </Section>

          <Section id="identifiers">
            <p>
              {"Some of the information above can identify a device over time: the internet address, the sign-in cookies and the account number in the browser."}
            </p>
            <p>
              {"We use them only to run the site. We use them to keep a player signed in, to keep progress in the correct account, to stop attacks, to find and fix errors, and to measure how fast pages load."}
            </p>
            <p>
              {"We do not use them to contact a person, to show ads, or to build a profile of a person. The site statistics use no cookies and no account number."}
            </p>
          </Section>

          <Section id="rights">
            <p>{"You can:"}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{"See the information that we have about your child."}</li>
              <li>{"Tell us to delete your child's information."}</li>
              <li>{"Tell us to stop collecting and using your child's information."}</li>
            </ul>
            <h4 className="pt-2 text-lg font-extrabold text-slate-900">How to ask</h4>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{"Contact the operator by email, phone or mail. The details are in \"Who runs this site\"."}</li>
              <li>{"Tell us the email address on your child's account."}</li>
              <li>{"Before we show or delete anything, we make sure that the request comes from the child's parent. For example, we ask you to confirm the request from the email address on the account."}</li>
              <li>{"We answer within 30 days."}</li>
            </ol>
            <h4 className="pt-2 text-lg font-extrabold text-slate-900">What we do</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>{"To show you the information, we send you a copy of the account details, the game progress and the leaderboard scores."}</li>
              <li>{"To delete the information, we delete the account. This deletes the account details, the game progress and the leaderboard scores together. The copies in our backups expire as \"Backup copies\" describes."}</li>
              <li>{"To stop collection, we delete the account. Your child can still play every game without an account. Without an account, progress stays only on the device, and the games do not save it on our server."}</li>
            </ul>
            <h4 className="pt-2 text-lg font-extrabold text-slate-900">What you can do yourself</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>{"Sign in to the account and open My Profile. It shows the name, the email address, the random player name and the game stats."}</li>
              <li>{"Sign out on a shared device. This removes the account's game progress from that device."}</li>
            </ul>
          </Section>

          <Section id="safety">
            <ul className="list-disc space-y-1 pl-5">
              <li>{"Every page of the site uses an encrypted connection (HTTPS)."}</li>
              <li>{"We keep passwords only as scrambled codes (bcrypt hashes)."}</li>
            </ul>
          </Section>

          <Section id="changes">
            <p>
              {"When we change what we collect or how we use it, we update this page and the date below."}
            </p>
            <p className="font-semibold text-slate-700">Last updated: {updated}</p>
          </Section>
        </article>
      </main>
    </div>
  );
}

export default PrivacyNotice;
