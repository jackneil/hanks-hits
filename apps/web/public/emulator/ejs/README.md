# EmulatorJS files: notes for maintainers

This folder holds the EmulatorJS files that Retro Arcade uses. Each version
has its own folder, for example `4.2.3/`. The file `NOTICE.txt` in that folder
tells users about each part, its license and its source code.

**WARNING:** Do not commit the source archives in `<version>/source/`. Git
ignores that folder. Each clone keeps each committed file for ever, and the
archives are about 131 MB.

## How the site gives the source code

1. The site sends the EmulatorJS files and the emulator cores to each browser.
   Thus the site must also give their source code from the same place
   (GPL-3.0 section 6(d), GPL-2.0 section 3, MPL-2.0 section 3.2).
2. `<version>/manifest.json` lists each source archive. Each entry has the
   URL, the size (`bytes`) and the SHA-256 of the archive.
3. The Docker build downloads each archive in the stage `emulator-sources` of
   the `Dockerfile`. It checks the size and the SHA-256 of each archive. For a
   GitHub archive, it also checks the commit in the archive header.
4. The build tries each URL 4 times. When it cannot get a correct archive, the
   build stops. Thus the site does not go live without the source code.
5. The stage uses only `manifest.json` and `apps/web/scripts/emulatorjs-sources.mjs`.
   Docker keeps the result in its cache until one of the two files changes.

## Get the source archives for a local run

Do this procedure when you run the site on your computer and you want the
source links in `NOTICE.txt` to work.

1. Go to the root of the repository.
2. Run `pnpm --filter web emulator:sources`.

The command downloads about 131 MB into `4.2.3/source/`. It checks the size
and the SHA-256 of each file. When a correct file is already there, the
command does not download it again.

## Check the files

1. Go to `apps/web`.
2. Run `node scripts/emulatorjs-sources.mjs 4.2.3`.

The command does not use the network. It checks the license texts and
`NOTICE.txt`. It also checks each source archive that is in `4.2.3/source/`,
and it tells you which archives are not there. The tests in
`apps/web/src/games/retro-arcade/__tests__/` do the same checks.

## When the build cannot get an archive

1. Read the error. It gives the file and the reason for each try.
2. If the reason is an HTTP error or "no data", the host has a problem. Wait,
   then start the build again.
3. If the reason is "SHA-256", the host sent different bytes. Do not remove
   the check. Do these steps:
   1. Remove `bytes` and `sha256` from the entry in `manifest.json`.
   2. In `apps/web`, run
      `node scripts/emulatorjs-sources.mjs 4.2.3 --fetch --sources --record`.
      The script checks that a GitHub archive holds the commit in the entry,
      then it writes the new size and SHA-256.
   3. If the size in `NOTICE.txt` is now wrong, change it. Then run
      `node scripts/emulatorjs-sources.mjs 4.2.3 --record`.
   4. Run the retro-arcade tests.

## When you change the EmulatorJS version

Do the steps in the header of `apps/web/scripts/vendor-emulatorjs.mjs` and
`apps/web/scripts/emulatorjs-sources.mjs`. Also change the version in the
`Dockerfile` (stage `emulator-sources` and the `COPY --from=emulator-sources`
line) and in the `emulator:sources` script of `apps/web/package.json`. A test
fails until these values agree.
