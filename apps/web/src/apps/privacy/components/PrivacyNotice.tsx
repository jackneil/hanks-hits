import type { ReactNode } from "react";
import { Header } from "@/shared/components/Header";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { SITE } from "@/config/site";
import { canPublishPrivacyNotice, type LegalContact, type PrivacyNoticeConfig } from "@/config/legal";
import { HIDDEN_KEEP_DAYS, PUBLIC_KEEP_MONTHS, UPLOAD_LEDGER_KEEP_MS } from "@/lib/leaderboard-clips/retention";
import {
  KID_SUMMARY, NOTICE_SECTIONS, PLAYER_SAVE_DETAILS, PRIVACY_NOTICE_UPDATED,
  SIGN_IN_COOKIE_DAYS, formatNoticeDate, kidSummarySpeech, phoneHref, sectionTitle,
  type NoticeSectionId,
} from "../lib/notice";

function Section({ id, children }: { id: NoticeSectionId; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-3">
      <h3 id={`${id}-title`} className="text-2xl font-extrabold text-slate-900">{sectionTitle(id)}</h3>
      {children}
    </section>
  );
}

function ContactDetails({ contact, preview }: { contact: LegalContact; preview: boolean }) {
  const addressLines = contact.mailingAddress.split(/\r?\n/).filter((line) => line.trim());
  const phoneLink = phoneHref(contact.phone);
  const missing = <span className="text-slate-600">Not supplied for this draft</span>;
  const rows = [
    { label: "Operator", supplied: !!contact.operatorName, value: contact.operatorName || missing },
    {
      label: "Mailing address",
      supplied: addressLines.length > 0,
      value: addressLines.length ? (
        <address className="not-italic">
          {addressLines.map((line, index) => <span key={index} className="block">{line}</span>)}
        </address>
      ) : missing,
    },
    {
      label: "Phone",
      supplied: !!contact.phone,
      value: phoneLink ? (
        <a href={phoneLink} className="inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline underline-offset-2">{contact.phone}</a>
      ) : contact.phone || missing,
    },
    {
      label: "Email",
      supplied: !!contact.email,
      value: contact.email ? (
        <a href={`mailto:${contact.email}`} className="inline-flex min-h-[44px] items-center break-all font-semibold text-blue-700 underline underline-offset-2">{contact.email}</a>
      ) : missing,
    },
  ];
  return (
    <dl data-testid="operator-contact" className="divide-y divide-slate-200 rounded-2xl bg-slate-100 px-5 py-2">
      {rows.filter((row) => preview || row.supplied).map((row) => (
        <div key={row.label} className="py-3 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-6">
          <dt className="font-bold text-slate-900">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface PrivacyNoticeProps {
  config: PrivacyNoticeConfig;
  /** Only an isolated local review should render the incomplete draft. */
  preview?: boolean;
}

/** The public route and this component both reject incomplete publication. */
export function PrivacyNotice({ config, preview = false }: PrivacyNoticeProps) {
  if (!preview && !canPublishPrivacyNotice(config)) return null;
  const updated = formatNoticeDate(PRIVACY_NOTICE_UPDATED);
  const hasOptionalContact = config.mailingAddress !== "" || config.phone !== "";

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-8">
        <h1 className="text-4xl font-black text-white">Privacy at {SITE.name}</h1>
        {preview && (
          <aside aria-label="Unpublished draft" className="rounded-2xl bg-amber-100 p-5 text-slate-900">
            <p className="font-bold">Unpublished draft for review</p>
            <p>The responsible adult, working request contact and process, coverage assessment, video storage provider and retention details still need verification. This draft makes no compliance or exemption claim.</p>
          </aside>
        )}
        <section aria-labelledby="kids-title" className="rounded-3xl bg-amber-50 p-6 text-slate-900 shadow-xl sm:p-8">
          <h2 id="kids-title" className="text-3xl font-black">For kids: what we save</h2>
          <ul className="mt-5 space-y-4 text-xl leading-snug">
            {KID_SUMMARY.map((line) => (
              <li key={line.text} className="flex items-start gap-3">
                <span aria-hidden="true" className="w-8 shrink-0 text-2xl leading-none">{line.emoji}</span>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
          <ReadAloudButton text={kidSummarySpeech()} className="mt-6" />
        </section>
        <article aria-labelledby="grown-ups-title" className="space-y-10 rounded-3xl bg-white p-5 text-base leading-relaxed text-slate-800 shadow-xl [overflow-wrap:anywhere] sm:p-10">
          <header className="space-y-3">
            <h2 id="grown-ups-title" className="text-3xl font-black text-slate-900">For grown-ups: how the site saves information</h2>
            <p className="font-semibold text-slate-700">{preview ? "Draft updated" : "Last updated"}: {updated}</p>
            <nav aria-label="Jump to a part of this page">
              <ul className="flex flex-wrap gap-2">
                {NOTICE_SECTIONS.map((section) => (
                  <li key={section.id}><a href={`#${section.id}`} className="inline-flex min-h-[44px] items-center rounded-xl bg-slate-100 px-4 font-semibold text-slate-900 hover:bg-slate-200">{section.navLabel}</a></li>
                ))}
              </ul>
            </nav>
          </header>
          <Section id="about">
            <p>{SITE.name} is a personal games and apps project. It does not earn revenue at this time. This page explains what the site saves and what other people can see.</p>
          </Section>
          <Section id="accounts">
            <p>An account is optional. Email sign-up asks for an email address and password, and can include a display name. The site stores a password hash rather than the password itself.</p>
            <p>With Google sign-in, the site receives Google account information including a name, email address and profile picture link, and stores account identifiers and sign-in information. Your account page can show your account details and game statistics.</p>
            <p>Sign-in uses browser cookies. The sign-in configuration has a {SIGN_IN_COOKIE_DAYS}-day session lifetime. The site also uses short-lived information to protect sign-in and limit repeated requests.</p>
          </Section>
          <Section id="progress">
            <p>The browser keeps game progress so you can continue on this device. When you are signed in, games can send progress to the site&apos;s server so it can load on another device. This can include scores, levels, coins, settings and saved items.</p>
            <p>Some saves can also include things you enter or make. These are not all device-only today:</p>
            <ul className="list-disc space-y-1 pl-5">{PLAYER_SAVE_DETAILS.map((line) => <li key={line}>{line}</li>)}</ul>
            <p>Choosing to sign in can carry guest progress into the signed-in account. On a shared device, the site keeps local saves separated by account. It also keeps local recovery copies when saves disagree or a save may not have reached the server.</p>
            <p>Signing out stops the current signed-in session, but preserves local save partitions and recovery originals.</p>
          </Section>
          <Section id="retro">
            <p>New Retro Arcade save-state files are kept in browser storage on this device and are not included in normal cloud progress. Cartridge battery saves also use browser storage.</p>
            <p>The file bytes of a ROM you add stay in memory for the current visit. Its game name and console details can be saved with progress. Older saved copies can still contain information written by previous versions.</p>
          </Section>
          <Section id="public">
            <p>A leaderboard can show a generated gamer name, best scores, game statistics and dates. The public score response does not include the account email, account display name or profile picture. You can turn off &ldquo;Show my gamer name on leaderboards&rdquo; in My Profile.</p>
            <p>Gameplay clips kept in Saved Clips are stored in the browser on your device. The clip feature captures the game&apos;s picture and game audio. It does not use the device microphone or camera. If you share a clip through your device&apos;s share sheet, the people or service you choose receive the file.</p>
            <p>If you choose to post a game video on the site, the video and its preview picture are uploaded to cloud storage. The site records the associated gamer profile, game, optional run score, upload time and video details. Other visitors can watch the posted video. Anything visible in the game picture can be visible in the video.</p>
            <p>You can remove a posted video using its removal control. Posting a new video for the same game replaces the previous one. Reporting a public clip hides it.</p>
            <p>The site&apos;s automatic clip cleanup is configured for public clips older than {PUBLIC_KEEP_MONTHS} months and reported clips hidden for more than {HIDDEN_KEEP_DAYS} days. Upload-limit ledger entries have a configured cleanup threshold of {UPLOAD_LEDGER_KEEP_MS / (24 * 60 * 60 * 1000)} days. Storage failures can delay cleanup. Copies specially kept for a legal or safety report are separate from routine clip cleanup. These are site cleanup settings, not a guarantee about every copy held by a storage provider.</p>
          </Section>
          <Section id="sharing">
            <ul className="list-disc space-y-3 pl-5">
              <li><strong>Railway:</strong> runs the app server and database. The server stores account information, cloud game progress, score records and clip records.</li>
              <li><strong>{config.clipStorageProvider || "Cloud storage for posted videos"}:</strong> stores uploaded videos and preview pictures. Watching a posted video can contact that storage service directly. {preview && !config.clipStorageProvider && <span>The deployed provider still needs confirmation before publication.</span>}</li>
              <li><strong>Cloudflare:</strong> provides network delivery, security and site analytics. Hosted pages include a Cloudflare analytics script that contacts Cloudflare.</li>
              <li><strong>Google:</strong> is contacted when you choose Google sign-in. A Google profile picture can load from Google.</li>
              <li><strong>Open-Meteo:</strong> the Weather app sends a place-search phrase to its search service and the selected place&apos;s latitude and longitude to its forecast service.</li>
              <li><strong>icanhazdadjoke.com:</strong> the Jokes app requests jokes from this service.</li>
            </ul>
            <p>Retro Arcade&apos;s emulator program files are served by this site.</p>
          </Section>
          <Section id="identifiers">
            <p>When a browser contacts a website or one of these services, the service receives network information such as the internet address and browser request details. The site uses request counters to limit abuse, including counters associated with internet addresses, sign-in emails and accounts.</p>
            <p>The browser also keeps preferences, recently played games and ownership information used to separate local saves. Links you choose to open on another website are subject to that website&apos;s practices.</p>
          </Section>
          <Section id="deletion">
            <p>Account information and cloud game saves can remain after you stop using the site. The site does not currently delete whole accounts automatically for inactivity, and the current account page has no self-service account deletion button.</p>
            <p>Signing out, resetting a game, removing a drawing or removing a video each has a different scope. None should be treated as deleting the whole account.</p>
            <p>Local saves and recovery copies can remain until you remove them or the browser clears site data. Clearing browser data does not delete information already saved on the site&apos;s server. Deleting a server game save does not itself delete the account or all local copies.</p>
            {config.retentionDetails ? <p className="whitespace-pre-line">{config.retentionDetails}</p> : preview && <p className="rounded-xl bg-amber-50 p-4">Before publication, verify retention and deletion rules for account data, cloud progress, server logs, analytics, backups and copies held for legal or safety reports. No account-inactivity or backup-expiry promise has been selected for this draft.</p>}
          </Section>
          <Section id="operator">
            {config.operatorName ? <p>{config.operatorName} runs {SITE.name}.</p> : preview && <p>The responsible adult or actual operator has not yet been supplied.</p>}
            <ContactDetails contact={config} preview={preview} />
            {!preview && !hasOptionalContact && <p>Email is the public request contact.</p>}
          </Section>
          <Section id="requests">
            {config.requestProcess ? <p className="whitespace-pre-line">{config.requestProcess}</p> : preview && <p className="rounded-xl bg-amber-50 p-4">Before publication, establish a working process for a parent or guardian to review information, request deletion or stop further collection. Confirm who handles requests, how authority is checked, and what happens to local copies and backups. This draft promises no response deadline.</p>}
            <p>You can sign in to My Profile to see account details and game statistics, and use the leaderboard visibility setting there. A grown-up should review this page before creating an account or posting a video.</p>
          </Section>
        </article>
      </main>
    </div>
  );
}

export default PrivacyNotice;
