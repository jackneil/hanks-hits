import type { ReactNode } from "react";
import { Header } from "@/shared/components/Header";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { SITE } from "@/config/site";
import {
  AAC_BUILD_FILES,
  AAC_MODULE_PATH,
  AAC_MODULE_SHA256,
  EMULATORJS_DIR,
  EMULATORJS_MANIFEST_PATH,
  EMULATORJS_NOTICE_PATH,
  EMULATORJS_RELEASE_SHA256,
  EMULATORJS_SOURCE_DIR,
  EMULATORJS_VERSION,
  FFMPEG_SHA256,
  FFMPEG_TARBALL_PATH,
  KID_NOTE,
  LGPL_RIGHTS,
  LICENSES_UPDATED,
  NOTICE_PATH,
  THIRD_PARTY_COMPONENTS,
  aacBuildFileHref,
  type LicenseLink,
  type ThirdPartyComponent,
} from "../lib/components";

/**
 * The /licenses page: the open-source software that the site ships (the clip
 * maker and Retro Arcade), with the license of each part and a link to its
 * source code.
 *
 * The page is for grown-ups. A short note at the top tells a kid that, with
 * a read-aloud button. All data comes from ../lib/components.ts.
 */

const LINK_CLASS =
  "inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900";

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function DocLink({ link }: { link: LicenseLink }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {link.label}{" "}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  return (
    <a href={link.href} className={LINK_CLASS}>
      {link.label}
    </a>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-6">
      <dt className="font-bold text-slate-900">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ComponentCard({ component }: { component: ThirdPartyComponent }) {
  return (
    <section
      id={component.id}
      aria-labelledby={`${component.id}-title`}
      data-testid="license-component"
      className="scroll-mt-24 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:p-5"
    >
      <h3 id={`${component.id}-title`} className="text-xl font-extrabold text-slate-900">
        {component.name}
      </h3>
      <p className="mt-2">{component.purpose}</p>
      <dl className="mt-3 divide-y divide-slate-200">
        <Row label="Version">{component.version}</Row>
        <Row label="License">
          <p>{component.license}</p>
          {component.moreLicenseTexts?.length ? (
            <ul className="space-y-1">
              {[component.licenseText, ...component.moreLicenseTexts].map((link) => (
                <li key={link.href}>
                  <DocLink link={link} />
                </li>
              ))}
            </ul>
          ) : (
            <DocLink link={component.licenseText} />
          )}
        </Row>
        <Row label="Source code">
          <ul className="space-y-1">
            {component.source.map((link) => (
              <li key={link.href}>
                <DocLink link={link} />
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Copyright">{component.copyright}</Row>
      </dl>
      {component.notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {component.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LicensesPage() {
  return (
    <div className="min-h-dvh bg-slate-950">
      <Header />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-8">
        <h1 className="text-4xl font-black text-white">Licenses</h1>

        <section aria-labelledby="kids-title" className="rounded-3xl bg-amber-50 p-6 text-slate-900 sm:p-8">
          <h2 id="kids-title" className="text-2xl font-black">
            For kids
          </h2>
          <p className="mt-3 text-xl leading-snug">{KID_NOTE}</p>
          <ReadAloudButton text={KID_NOTE} className="mt-5" />
        </section>

        <article
          aria-labelledby="grown-ups-title"
          data-testid="grown-ups-notice"
          // break-words: the key and hash strings have no spaces and must wrap on a phone.
          className="space-y-8 break-words rounded-3xl bg-white p-5 text-base leading-relaxed text-slate-800 sm:p-10"
        >
          <header className="space-y-3">
            <h2 id="grown-ups-title" className="text-3xl font-black text-slate-900">
              For grown-ups: open-source software on this site
            </h2>
            <p className="font-semibold text-slate-700">Last updated: {formatDate(LICENSES_UPDATED)}</p>
            <p>
              {`${SITE.name} uses the open-source software below to make game clips and to play the games in Retro Arcade. This page tells you what each part does, its license, and where to get its source code.`}
            </p>
            <p>
              {"The notice file has the same information as plain text: "}
              <a href={NOTICE_PATH} className={LINK_CLASS}>
                NOTICE.txt
              </a>
            </p>
          </header>

          <div className="space-y-4">
            {THIRD_PARTY_COMPONENTS.map((component) => (
              <ComponentCard key={component.id} component={component} />
            ))}
          </div>

          <section id="aac-build" aria-labelledby="aac-build-title" className="scroll-mt-24 space-y-3">
            <h3 id="aac-build-title" className="text-2xl font-extrabold text-slate-900">
              How we build the AAC module
            </h3>
            <p>
              {`The AAC module is the file ${AAC_MODULE_PATH}. We build it from the FFmpeg source code file on this page. These files show every step, and they let you build the module again:`}
            </p>
            <ul className="space-y-1">
              {AAC_BUILD_FILES.map(({ file, about }) => (
                <li key={file} className="flex flex-wrap items-center gap-x-2">
                  <a href={aacBuildFileHref(file)} className={LINK_CLASS}>
                    {file}
                  </a>
                  <span className="text-slate-600">{about}</span>
                </li>
              ))}
            </ul>
            <dl className="divide-y divide-slate-200 rounded-2xl bg-slate-100 px-5 py-2">
              <Row label="Source SHA-256">
                <code className="break-all text-sm">{FFMPEG_SHA256}</code>
              </Row>
              <Row label="Module SHA-256">
                <code className="break-all text-sm">{AAC_MODULE_SHA256}</code>
              </Row>
            </dl>
            <p>
              {"Two clean builds give a module with the same SHA-256. The script verify.sh checks this."}
            </p>
          </section>

          <section id="your-rights" aria-labelledby="your-rights-title" className="scroll-mt-24 space-y-3">
            <h3 id="your-rights-title" className="text-2xl font-extrabold text-slate-900">
              Your rights for the FFmpeg part
            </h3>
            <p>{"The LGPL gives you these rights:"}</p>
            <ul className="list-disc space-y-1 pl-5">
              {LGPL_RIGHTS.map((right) => (
                <li key={right}>{right}</li>
              ))}
            </ul>
            <p>
              {"You can get the FFmpeg source code from this site, at the same place as the module: "}
              <a href={FFMPEG_TARBALL_PATH} className={LINK_CLASS}>
                {FFMPEG_TARBALL_PATH}
              </a>
            </p>
          </section>

          <section id="retro-arcade-source" aria-labelledby="retro-arcade-source-title" className="scroll-mt-24 space-y-3">
            <h3 id="retro-arcade-source-title" className="text-2xl font-extrabold text-slate-900">
              The Retro Arcade source code
            </h3>
            <p>
              {`The folder ${EMULATORJS_DIR}/ on this site has the EmulatorJS files, the emulator cores, their license texts and their source code. The source code files are in ${EMULATORJS_SOURCE_DIR}/. You can download them at no cost, and you do not need an account. We keep them on this site for as long as we send the emulator files.`}
            </p>
            <ul className="space-y-1">
              <li className="flex flex-wrap items-center gap-x-2">
                <a href={EMULATORJS_NOTICE_PATH} className={LINK_CLASS}>
                  {EMULATORJS_NOTICE_PATH}
                </a>
                <span className="text-slate-600">Each part, its license, and how to build it</span>
              </li>
              <li className="flex flex-wrap items-center gap-x-2">
                <a href={EMULATORJS_MANIFEST_PATH} className={LINK_CLASS}>
                  {EMULATORJS_MANIFEST_PATH}
                </a>
                <span className="text-slate-600">The size and the SHA-256 of each file and each source code file</span>
              </li>
            </ul>
            <dl className="divide-y divide-slate-200 rounded-2xl bg-slate-100 px-5 py-2">
              <Row label={`EmulatorJS ${EMULATORJS_VERSION} release SHA-256`}>
                <code className="break-all text-sm">{EMULATORJS_RELEASE_SHA256}</code>
              </Row>
            </dl>
          </section>
        </article>
      </main>
    </div>
  );
}

export default LicensesPage;
