# Accounts and COPPA: an account keeps only a Google sign-in id

Issue: #26i (the sign-up page collected a child's email address with no notice to a parent).
Decision date: 2026-10-01. Owner: the operator of Hank's Hits.

This document records the decision, the legal basis, how the code enforces the
decision, how to purge the old data, and the text for the privacy notice (PR #42pr).

The fix for #26i is split into three changes. This document is about part A.

| Part | Branch | What it does | Document |
|---|---|---|---|
| A | `fix/coppa-accounts` | The accounts core: Google-only sign-in, an account keeps only the Google subject id, "Delete this account", the purge of `users` and `accounts` | This document |
| B | `fix/sync-default-stamps` | Sync timestamps: untouched progress never replaces the account's progress | The PR of part B |
| C | (to be made) | Typed words stay on the device, in a local word store for each player (closes #23i) | `design/LOCAL_WORDS.html` |

CAUTION: Merge part A AFTER part C is live. The notice on `/login` (section
2.3) says that the words a player types stay on the device. That is true only
when part C is live. The order is B, then C, then A (`design/LOCAL_WORDS.html`,
section 6). Part C also clears the old typed words from the server
(`design/LOCAL_WORDS.html`, section 4). The purge of part A does not. Do not
replace the old backups (section 6.1, step 12) before that clear has run.

## 1. The decision

Hank's Hits is a website for children. The amended COPPA Rule is enforceable
from 2026-04-22. The old sign-up page asked a child for a name, an email
address and a password, and it gave no notice to a parent.

We changed sign-in to this design:

1. Sign-in is Google only. The email and password sign-up page, its API and
   the password code are removed. Old links to `/signup` go to `/login`.
2. An account keeps only one item from Google: the Google subject id (the
   `sub` claim). It keeps no email address, no name, no photo, no
   `email_verified` date and no OAuth token.
3. The site gives each account a gamer name that it picks at random (for
   example "TurboFox42"). The player cannot choose or type it. The screens
   show this gamer name, never a real name.
4. Guest play does not change. A child can play every game without signing in.
5. Words that a player types in a game stay on the device. Part C does this
   (`design/LOCAL_WORDS.html`). Part A does not change game progress.
6. A player has one sign-in account. A sign-in never links a second Google
   account to the player who is signed in on that browser.
7. A grown-up can delete the account at any time from the profile page.
   The delete removes everything that the account holds.

## 2. The legal basis

All quotes are from 16 CFR Part 312 as published on eCFR on 2026-10-01
(https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312).

### 2.1 The exception that we use: 312.5(c)(7)

> (7) Where an operator collects a persistent identifier and no other personal
> information and such identifier is used for the sole purpose of providing
> support for the internal operations of the website or online service. In
> such case, the operator shall provide notice under § 312.4(d)(3);

The Google subject id is a persistent identifier (312.2, definition of
"personal information", item (7)). Our own random user id is also one. When an
account keeps these ids and no other personal information, and we use them
only for internal operations, no verifiable parental consent is necessary.

CAUTION: The exception has two conditions. The account must keep no other
personal information (section 2.4, section 2.5 and section 8), and the
312.4(d)(3) notice must be live (section 2.3). If one condition stops, the
exception stops.

This change puts the 312.4(d)(3) text on `/login`, in the part "For grown-ups"
(`apps/web/src/app/login/copy.ts`). That page is where the site collects the
sign-in id. The home page links to it with "Privacy for grown-ups"
(`apps/web/src/app/HomeClient.tsx`). The full privacy notice of #42pr, with
the operator's contact details of 312.4(d)(1), replaces that link target when
it merges. Do not remove the `/login` text before the full notice is live.

### 2.2 The internal operations: 312.2

> _Support for the internal operations of the website or online service_ means:
> (1) Those activities necessary to: (i) Maintain or analyze the functioning of
> the website or online service; (ii) Perform network communications;
> (iii) Authenticate users of, or personalize the content on, the website or
> online service; [...]
> (2) Provided, however, that, except as specifically permitted by paragraphs
> (1)(i) through (vii) of this definition, the information collected for the
> activities listed in paragraphs (1)(i) through (vii) of this definition cannot
> be used or disclosed to contact a specific individual, including through
> behavioral advertising, to amass a profile on a specific individual, or for
> any other purpose.

We use the ids for these operations only:

| Operation | 312.2 item |
|---|---|
| Sign the player in | (1)(iii) "Authenticate users" |
| Keep the player's saved games, scores and gamer name with the correct account | (1)(iii) "personalize the content" |
| Stop attacks and limit how fast requests come | (1)(v) "Protect the security or integrity" |

The FTC COPPA FAQ, section J, question 8, says that personalization "was
intended to permit operators to maintain user driven preferences, such as game
scores, or character choices in virtual worlds"
(https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).

### 2.3 The notice that we must give: 312.4(d)(3)

> (3) If applicable, the specific internal operations for which the operator
> has collected a persistent identifier pursuant to § 312.5(c)(7); and the
> means the operator uses to ensure that such identifier is not used or
> disclosed to contact a specific individual, including through behavioral
> advertising, to amass a profile on a specific individual, or for any other
> purpose (except as specifically permitted to provide support for the internal
> operations of the website or online service);

The `/login` note gives this text now (section 2.1). Its second line
(`LOGIN_NOTE_NOT_KEPT`) says: "Names, notes, drawings and places that a player
types or makes in a game stay on the device." Part C makes that line true. So
part A merges after part C (the caution at the top). Section 7 of this
document gives the same text for the full privacy notice of #42pr.

### 2.4 Why the email address, the name and the photo had to go

312.2 lists these items as personal information: "(1) A first and last name",
"(3) Online contact information" (an email address is online contact
information), and "(8) A photograph, video, or audio file where such file
contains a child's image or voice". If an account keeps any of them, the
312.5(c)(7) exception does not apply, and verifiable parental consent is
necessary before collection. Google's `id_token` is a signed JWT that holds the
`email` claim when the `email` scope is granted, so a stored `id_token` is also
an email address.

### 2.5 Why the words that a player types stay on the device

312.2 also lists:

> (9) Geolocation information sufficient to identify street name and name of a
> city or town;
>
> (11) Information concerning the child or the parents of that child that the
> operator collects online from the child and combines with an identifier
> described in this definition.

The definition of "collects or collection" includes "(1) Requesting,
prompting, or encouraging a child to submit personal information online".
Oregon Trail asks "What is your name, wagon leader?" with the placeholder
"Your first name", and then asks for family names. A saved game row is keyed
by the account's user id. So a first name that a child types, stored with the
account, is item (11) personal information. A town that a child looks up in
the Weather app can be item (9). A pet name, a beat name, a wishlist note or
the words on a 4-Wheeler outfit can hold a name too. If the account keeps any
of these, the 312.5(c)(7) exception does not apply.

Part C keeps these words on the device. Part C also clears the old words from
the server, with its own SQL file and its own `VACUUM FULL "app_progress"`
(`design/LOCAL_WORDS.html`, section 4). Part A does not change game progress,
and its purge does not touch `app_progress` (section 6).

### 2.6 The rights of a parent: 312.6

The sign-in id is personal information (item (7)), so a parent keeps the
rights of 312.6. 312.6(a)(2) gives a parent "the opportunity at any time to
refuse to permit the operator's further use or future online collection of
personal information from that child, and to direct the operator to delete
the child's personal information". The account keeps no email address, so we
cannot confirm a parent by email. A parent proves the account by signing in to
it with the child's Google account. Then the profile page shows everything
that the account keeps, and "Delete this account" deletes it.

## 3. What an account keeps and does not keep

| Data | Kept | Where | Why |
|---|---|---|---|
| Google subject id | Yes | `accounts.provider_account_id` | Sign the player in |
| Our random user id | Yes | `users.id`, and in the session cookie | Link the account to its data |
| Gamer name (random) | Yes | `gaming_profiles.handle`, and in the session cookie | Show the player without a real name |
| Game progress | Yes | `app_progress` | Keep the player's games |
| Leaderboard scores | Yes | `leaderboard_entries` | Show the leaderboards |
| Account dates | Yes | `users.created_at`, `users.updated_at` | "Member since" on the profile |
| Email address | No | `users.email` is always NULL | |
| Name | No | `users.name` is always NULL | |
| Photo link | No | `users.image` is always NULL | |
| Email verified date | No | `users.email_verified` is always NULL | |
| Password | No | the column is dropped | |
| OAuth tokens and token claims | No | the `accounts` token columns are always NULL | |
| Names, notes, drawings and places that a player makes | No | they stay on the device (part C, `design/LOCAL_WORDS.html`) | |

## 4. How the code enforces the decision

Each rule has more than one layer. One mistake in one layer cannot store
personal information.

1. Google scope. `GOOGLE_SCOPE = "openid"` in `apps/web/src/lib/auth-privacy.ts`.
   Google then sends no email, name or picture claim. A live check on
   2026-10-01 with the production client: a request with `scope=openid` opens
   the Google sign-in page, the same as the old `openid email profile`. A
   request with an unknown scope goes to Google's `invalid_scope` error page.
2. Provider `profile()`. `googleProfile()` returns only the subject id, and null
   for the name, the email and the image.
3. Provider `account()`. `keepNoTokens()` returns an empty object, so Auth.js
   keeps no field of the token set.
4. Adapter wrapper. `withoutPersonalInfo()` wraps the Drizzle adapter.
   `createUser` writes NULL for each personal field. `updateUser` drops them.
   `linkAccount` writes only `userId`, `type`, `provider` and
   `providerAccountId`. This applies to every provider, also a provider that
   someone adds later.
5. Session. The `jwt` callback builds a new token that holds only `sub`, `id`,
   `handle` and `authTime` (the sign-in time). A cookie from before this
   change loses its name, email and picture the next time it is written. The
   `session` callback returns only `user.id`, `user.handle` and `expires`.
6. Database. The CHECK constraints `users_no_personal_info` and
   `accounts_no_tokens` reject a row that holds any of these fields
   (`packages/db/src/schema/auth.ts`, and the purge file).
7. Source check and types. `apps/web/src/__tests__/no-account-pii.test.ts`
   fails when app code reads `session.user.name`, `.email` or `.image`, or
   reads or writes `users.name`, `.email`, `.image` or `.emailVerified`, or
   brings back email and password sign-in. The session type
   (`apps/web/src/types/next-auth.d.ts`) has only `id` and `handle`, so the
   compiler also rejects a destructuring read of a name, an email or an image.

The gamer name comes from `sessionGamerName()` in
`apps/web/src/lib/gaming-profile.ts`. The `jwt` callback calls it on each
session read. It makes the gamer name at the first sign-in. If that fails,
sign-in still works, the header says "Player", and the next read tries again.
When the users row does not exist (the account was deleted), it returns
`ACCOUNT_GONE`, and the `jwt` callback returns null. Auth.js then clears the
cookie, so a deleted account signs out on each device at its next page load.
If the database gives an error, or gives no answer in 1.5 seconds
(`GAMER_NAME_TIMEOUT_MS` in `apps/web/src/lib/auth.ts`), the session stays,
with the gamer name that the cookie holds. The database pool
(`packages/db/src/index.ts`) also stops a connection after 5 seconds and a
query after 30 seconds, so no route waits for the minutes of a TCP timeout.

`getOrCreateGamingProfile()` (same file) makes the gamer name. It is safe
when two tabs make it at the same time (ON CONFLICT on `user_id`), and it
tries a new random name when another player has the same name. Each insert
runs in its own savepoint, so a failed insert does not stop the caller's
transaction. The progress route uses it too, inside its transaction, when a
score reaches a leaderboard. Before this change, the progress route's retry
did not see the collision (Drizzle puts the Postgres error on `cause`), and
a failed insert stopped the whole save transaction.

A sign-in lasts 30 days from the sign-in. Auth.js writes the cookie again
with a new expiry on each read (a sliding session), so a cookie that is used
once a month would never end. The `jwt` callback keeps the sign-in time in
the cookie (`signInTime()` in `apps/web/src/lib/auth-privacy.ts`) and returns
null 30 days after it (`sessionTooOld()`). The cookie is encrypted, so a
client cannot change the time. A cookie from before this change gets its 30
days from its next read.

### 4.1 One sign-in account per player

Auth.js links a Google account that is new to the site to the player who is
signed in on that browser (`@auth/core` `lib/actions/callback/handle-login.js`).
That Google account then opens the first player's account on any device. On a
shared family computer, two children would share one account. Three layers
stop this:

1. `/login` shows "You are signed in" and "Sign out" instead of the Google
   button when the browser is signed in.
2. `oneAccountPerPlayer()` (`apps/web/src/lib/auth-privacy.ts`) wraps the
   adapter. `linkAccount` refuses when the player already has an account row
   (`apps/web/src/lib/sign-in-accounts.ts`). Auth.js then sends the browser to
   `/login?error`, and the session stays on the first player. This layer works
   from the deploy, before the purge.
3. The unique index `accounts_user_id_unique` makes it a database rule. The
   purge file adds it. Production on 2026-10-02 had 0 users with more than
   one account, so the index fits the data.

### 4.2 Words that a player types

Part A does not change how game progress syncs. Part C keeps the words that
a player types in a local word store on the device, one store for each player
(`hh-words:v1:<owner key>`), and the server strips them from uploads. Part C
also clears the old words that the server holds (`design/LOCAL_WORDS.html`,
section 4). Part A uses one item of part C: the key of the
word store (`apps/web/src/lib/local-words-key.ts`), for the delete in
section 4.3.

### 4.3 Delete this account

`DELETE /api/account` (`apps/web/src/app/api/account/route.ts`) deletes the
users row of the signed-in player. The foreign keys cascade to the account
link, the saved games, the gamer name and the scores
(`apps/web/src/lib/account-deletion.ts`). The control is "Delete this account"
in the part "For grown-ups" at the bottom of the profile page
(`apps/web/src/apps/profile/components/DeleteAccount.tsx`). The grown-up types
the gamer name to confirm (`apps/web/src/lib/gamer-name-confirm.ts`), and the
server checks it again, so a stray tap by a young player cannot delete the
account.

The 200 answer also expires every Auth.js session cookie that the request
holds (`authjs.session-token`, `__Secure-authjs.session-token`, and their
chunks `.0`, `.1`), so the delete does not depend on the browser's sign-out.

Then the page deletes the account's word store on this device
(`forgetLocalWords()` in `apps/web/src/lib/local-words-key.ts`: the key
`hh-words:v1:<owner key>`, made with `ownerKeyFor()` in
`apps/web/src/shared/clips/library/ownerKey.ts`). A sign-out keeps every word
store, so that the same player gets the words back at the next sign-in. A
deleted account does not sign in again, so its store goes now. The store of
another player and the guest store stay. If the store does not exist, nothing
happens. If the storage is blocked, the page logs it and continues.

Then the page signs out, which also clears the game saves on that device. If
that sign-out fails (a network drop), the page clears the game saves itself
and goes to the home page with a full page load. It never says that the
delete failed after the server deleted the account.

The words of a deleted account on OTHER devices stay on those devices. They
are not on the server, and no other account can read them (part C keeps one
store for each player).

## 5. How schema changes reach production

No deploy step runs a migration. Merging this change is a code deploy only. It
does NOT write to the production database. The purge in section 6 is a separate
production write that a person runs by hand, with a write grant.

Evidence, read on 2026-10-02:

| Where | What it shows |
|---|---|
| `railway.toml:1-3` | The build uses the Dockerfile. |
| `railway.toml:5-9` | The `[deploy]` block has no `startCommand` and no `preDeployCommand`. |
| `Dockerfile:47` | `RUN pnpm --filter web build`. `apps/web/package.json:7` is `pnpm generate:metadata && next build`. Neither touches the database. |
| `Dockerfile:77` | `CMD ["node", "apps/web/server.js"]`. The container starts the app and nothing else. |
| `packages/db/package.json:16-20` | Scripts `db:generate`, `db:push` and `db:studio`. There is no `migrate` script, and no build or deploy step calls these scripts. |
| Railway service `hanks-garage`, live deployment of `86a1fe0` | The service manifest has `preDeployCommand: null`, `startCommand: null`, builder `DOCKERFILE`, config file `/railway.toml` (read 2026-10-01). |
| Production database | It has no `drizzle` schema and no migrations table (read 2026-10-02). The schema came from `drizzle-kit push` (or by hand), not from `drizzle-kit migrate`. |

Railway deploys each push to `master` automatically. So a merge changes the
behavior of sign-in at once: new accounts keep no personal information, a
second Google account is not linked to a signed-in player, the session
cookies lose the old fields, and a sign-in ends 30 days after it started.
The rows that exist stay the same until the purge runs.

Each sign-in now leaves the page for Google and comes back with a full page
load (the email and password form signed in on the same page). So a guest's
gameplay clip ring in that tab, which lives in memory, is lost at sign-in.
Only a sign-in that another tab completes keeps it
(`design/GAMEPLAY_CLIPS.html`, section 7.1).

## 6. Purge steps

The purge has two files. Run them in this order.

`packages/db/drizzle/0001_coppa_google_id_only.sql` is one transaction. It
does these steps:

1. Sets `users.name`, `email`, `email_verified` and `image` to NULL.
2. Sets `accounts.refresh_token`, `access_token`, `expires_at`, `token_type`,
   `scope`, `id_token` and `session_state` to NULL.
3. Drops `users.password`. Nothing reads it after the Google-only change.
4. Adds the unique index `accounts_user_id_unique` (section 4.1).
5. Adds the CHECK constraints `accounts_no_tokens` and `users_no_personal_info`.

The file does not touch `app_progress`. The typed words in `app_progress` are
part C's job: part C moves them to the device first, then clears them on the
server with its own SQL file and its own `VACUUM FULL "app_progress"`
(`design/LOCAL_WORDS.html`, section 4). A clear in this file could delete
words that no device holds yet.

`packages/db/scripts/typed-words-count.sql` is read only. It counts the
`app_progress` rows that still hold a value in a typed-word field (the fields
of `design/LOCAL_WORDS.html`, section 3), and prints `total|<n>` on its last
line. Steps 6 and 10 read it. Step 12 waits until it prints `total|0`. A value
can be the game's own default word (a pet called by its species name), so
before part C's clear the total is an upper limit. The purge test runs this
file too.

`packages/db/scripts/coppa-purge-vacuum.sql` runs `VACUUM FULL` on `users`
and `accounts`, then `CHECKPOINT`. An UPDATE writes a new row version and
leaves the old bytes in the table file and in the indexes
(`users_email_unique` holds every email address). Autovacuum does not run on
tables this small (threshold 50 dead rows). A plain VACUUM keeps the same
files, so old bytes can stay in the free space of a page. `VACUUM FULL`
writes new table and index files with the live rows only, and deletes the
old files. It cannot run in a transaction, so it is a second file. The local
test (`apps/web/src/__tests__/coppa-purge-migration.test.ts`) reads the
files before and after: the synthetic values are in the files after the
UPDATE, and gone after the vacuum file, and each table has new files.

Production on 2026-10-02 (aggregate counts only, read only): 4 users, 4 with
an email, 4 with a name, 3 with an image, 0 with `email_verified`, 0 with a
password (the column exists). 4 accounts, all `google` / `oidc`, 4 with an
`access_token` and an `id_token`, 0 with a `refresh_token` or a
`session_state`. 4 gaming profiles (every user has one). 47 `app_progress`
rows. 0 rows in `sessions`, `verification_tokens` and `authenticators`. 0
users with more than one account. The CHECK constraints do not exist yet.
`typed-words-count.sql` printed `total|2`: 1 Drum Machine row with saved
beats (the player types each beat name), and 1 Virtual Pet row. A second
count showed that the pet name of that row is a default species name, not a
typed word (the values were not read). Part C's clear removes both.

### 6.1 Order

CAUTION: Run the purge only AFTER the Google-only code is live. The old code
reads `users.password` on each user read, so it fails when the column is gone.

1. Merge part B and part C, and let Railway deploy them (the caution at the
   top of this document). Part C's server clear of `app_progress` follows
   part C's own steps (`design/LOCAL_WORDS.html`, section 4). It can run
   before or after this purge, but it must run before step 12.
2. Merge this change and let Railway deploy it.
3. Make sure that the deploy is live: `railway deployment list --json` shows
   `SUCCESS` for the merge commit.
4. Sign in once with Google. Make sure that `/api/auth/session` shows only
   `user.id`, `user.handle` and `expires`.
5. Get a production write grant for the purge.
6. Read the counts before the purge (read only):

   ```sql
   SELECT count(*), count(email), count(name), count(image) FROM users;
   SELECT count(*), count(access_token), count(id_token) FROM accounts;
   SELECT count(*) FROM gaming_profiles;
   SELECT count(*) FROM app_progress;
   SELECT count(*) FROM leaderboard_entries;
   ```

   Then read the typed-words count, and write down its last line:

   ```sh
   psql "$DATABASE_PUBLIC_URL" -X -q -At -v ON_ERROR_STOP=1 \
     -f packages/db/scripts/typed-words-count.sql > typed-before.log 2>&1; rc=$?; echo "EXIT:$rc"
   ```

7. Run the file as one transaction. Stop on the first error. Read the exit code
   before you do anything else:

   ```sh
   psql "$DATABASE_PUBLIC_URL" -X -v ON_ERROR_STOP=1 -1 \
     -f packages/db/drizzle/0001_coppa_google_id_only.sql > purge.log 2>&1; rc=$?; echo "EXIT:$rc"
   ```

   If the public proxy stalls (it did on 2026-10-02), run the same file
   through `railway ssh --service Postgres`.

8. Read the file numbers of the two tables (read only), for step 10:

   ```sql
   SELECT pg_relation_filenode('users'), pg_relation_filenode('accounts');
   ```

9. Run the vacuum file. Do NOT add `-1`. Read the exit code:

   ```sh
   psql "$DATABASE_PUBLIC_URL" -X -v ON_ERROR_STOP=1 \
     -f packages/db/scripts/coppa-purge-vacuum.sql > vacuum.log 2>&1; rc=$?; echo "EXIT:$rc"
   ```

   Each table is locked while it is rewritten. The tables are small, so each
   lock is shorter than one second.

10. Verify the result (read only). Each count of personal fields must be 0.
    Each row count must be the same as in step 6. Each file number from step 8
    must be different now. The typed-words total must be the same as in step
    6, because this purge does not change `app_progress`. (It is lower only
    when part C's clear ran between step 6 and now.)

    ```sql
    SELECT count(*) FROM users WHERE name IS NOT NULL OR email IS NOT NULL
      OR image IS NOT NULL OR email_verified IS NOT NULL;
    SELECT count(*) FROM accounts WHERE refresh_token IS NOT NULL OR access_token IS NOT NULL
      OR id_token IS NOT NULL OR expires_at IS NOT NULL OR token_type IS NOT NULL
      OR scope IS NOT NULL OR session_state IS NOT NULL;
    SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'password';
    SELECT conname FROM pg_constraint
      WHERE conname IN ('users_no_personal_info', 'accounts_no_tokens');
    SELECT indexname FROM pg_indexes WHERE indexname = 'accounts_user_id_unique';
    SELECT pg_relation_filenode('users'), pg_relation_filenode('accounts');
    ```

    ```sh
    psql "$DATABASE_PUBLIC_URL" -X -q -At -v ON_ERROR_STOP=1 \
      -f packages/db/scripts/typed-words-count.sql > typed-after.log 2>&1; rc=$?; echo "EXIT:$rc"
    ```

11. Sign in again with Google. The same account must open, with the same
    gamer name and the same saved games.
12. CAUTION: Do not do this step until part C's server clear and part C's
    `VACUUM FULL "app_progress"` have run (`design/LOCAL_WORDS.html`,
    section 4). Before part C's clear, a new backup still holds typed words.

    Read `typed-words-count.sql` again (the command of step 10). If the exit
    code is not 0, or the last line is not `total|0`, stop: part C's clear
    has not run. Then make sure that part C's runbook shows two different
    `app_progress` file numbers, before and after its vacuum. If not, stop:
    the old words can still be in the table file. When both checks pass,
    make a new backup that holds no personal information, then remove the
    old copies (section 6.2).

### 6.2 Copies that the purge does not reach

Each item below holds the rows from before the purge. Each removal is a
production write or a deletion that cannot be undone. The operator does it
only with Jack's grant, at step 12 of section 6.1 (after part C's clear and
its vacuum, with a typed-words total of 0).

- Railway backups of the database volume (the Backups tab;
  `railway postgres pitr backup list --service Postgres --json`). The volume
  has no automatic backup schedule (`railway postgres pitr schedule list`
  returns `[]`). On 2026-10-02 the list had four backups made by hand. Three
  have NO expiry date, so they keep the old rows until someone deletes them:

  | Name | Made | Expires |
  |---|---|---|
  | `Manual` | 2026-07-19 | never |
  | `Pre-Security-Patch Backup` | 2026-08-29 | 2026-09-28 (still listed on 2026-10-02) |
  | `pre-workspace-move-2026-09-02` | 2026-09-02 | never |
  | `post-workspace-move` | 2026-09-04 | never |

  After this purge, part C's clear and both vacuums, make a new backup
  (`railway postgres pitr backup create --service Postgres --name post-coppa-purge`),
  make sure that it is listed, then delete the old backups
  (`railway postgres pitr backup delete`). Deleting a backup needs Jack's
  grant: each delete cannot be undone.
- The point-in-time recovery archive (PITR is on, read 2026-10-02). Postgres
  sends each WAL segment to the bucket `postgres-pitr-a4nmqurghp0` with
  pgBackRest (`design/RAILWAY_WORKSPACE_MOVE.html`). Railway takes a full base
  backup each week and a differential backup each day, and keeps the last 4
  full backups (https://docs.railway.com/volumes/point-in-time-recovery). The
  base backups and the WAL from before a purge expire when the fourth full
  backup after it is taken: about 4 to 5 weeks after the later of this purge
  and part C's clear. To remove them at once, disable PITR and enable it
  again, at step 12 only. That deletes the
  archive bucket and all recovery history, so make the new backup above first,
  and get Jack's grant.
- The dump that was made by hand for the Railway move on 2026-09-02
  (`~/railway-backup/hanks-hits/pre-move.dump` on the operator's computer).
  Only the operator's user can open its folder (mode 0700). Delete it after
  the purge.
- Google. The Google accounts that signed in before this change gave the site
  the `email` and `profile` scopes. The site does not keep or use them. A
  grown-up can remove the old grant at https://myaccount.google.com/connections.

### 6.3 Do not use drizzle-kit on production for this change

- `drizzle-kit migrate` finds no migrations table, so it tries to run `0000`
  again and fails.
- `drizzle-kit push` compares the database to the schema. It tries to add the
  CHECK constraints before the data is purged, and that fails.

Use the psql command in step 7.

### 6.4 Rollback

The purge file is all or nothing. If it fails, nothing changes. A second run
after a successful run also fails and changes nothing (the column is gone).

To roll back the code: revert the merge commit on `master`, and Railway
deploys the old code. Before the purge, that is all. After a successful
purge, the old code does not work, because it reads `users.password`. So
first add the column back, with a production write grant:

```sql
ALTER TABLE users ADD COLUMN password text;
```

The old code can then sign in with Google again. It cannot store a new email,
name or photo while the CHECK constraints exist: a new Google sign-in fails.
To let the old code make new accounts, drop the constraints too
(`ALTER TABLE users DROP CONSTRAINT users_no_personal_info;` and
`ALTER TABLE accounts DROP CONSTRAINT accounts_no_tokens;`). Keep
`accounts_user_id_unique`: the old code works with it.

The purged values do not come back. The vacuum file changes no data, so it
needs no rollback.

## 7. Notice text for #42pr

PR #42pr (`apps/web/src/apps/privacy/components/PrivacyNotice.tsx` on branch
`clips/p0-3-privacy`) holds the privacy notice. Its text was written for the
old sign-up. Replace the items below. Each new line is true when parts A and C
are live. `DELETED_WITH_ACCOUNT` is the constant that the file already has.

### 7.1 The "account" data kind (replace the whole entry)

```ts
{
  id: "account",
  title: "Account details",
  what: [
    "A grown-up signs in with Google. We keep one thing from Google: a sign-in number for the Google account.",
    "We do not get or keep an email address, a name or a photo. We do not keep a password, and we do not keep the sign-in keys that Google sends.",
    "Names, notes, drawings and places that a player types or makes in a game stay on the device. We do not get them.",
    "When an account is made, the site picks a gamer name at random, like \"TurboRacer42\". The player cannot choose or type this name.",
    "We record the date that the account was made, and the date of the last change to the account.",
  ],
  use: [
    "We use the sign-in number only to sign the player in, and to keep the player's game progress, scores and gamer name with the correct account.",
    "These uses are the internal operations of the site. We never use the sign-in number to contact a player, to show ads, or to build a profile of a player.",
    "We collect no other personal information with the sign-in number. So the law does not ask a grown-up to give permission before a child signs in (16 CFR 312.5(c)(7)). This notice is part of that rule.",
    "We never send email or other messages to players.",
  ],
  who: [
    "Only the operator. The site never shows the sign-in number. It shows the gamer name on the player's own pages and on the leaderboards.",
  ],
  keep: [
    `We keep account details ${DELETED_WITH_ACCOUNT}`,
    "A grown-up can delete the account at any time. Sign in with the child's Google account, open Profile, and tap \"Delete this account\". This deletes the sign-in number, the gamer name, every saved game and every score.",
  ],
},
```

### 7.2 Kid summary (lib/notice.ts, `KID_SUMMARY`)

Add these lines after the line "If you make an account, we save your games so you can keep playing.":

```ts
{ emoji: "🔑", text: "A grown-up signs in with Google. We do not keep your email, your name or your photo." },
{ emoji: "📝", text: "Names you type in a game stay on your device." },
```

### 7.3 The "identifiers" section (the 312.4(d)(3) text)

Replace the four paragraphs with these:

1. "Some of the information above can identify a person or a device over time: the Google sign-in number, the account number, the sign-in cookie and the internet address."
2. "We use them only for the internal operations of the site: to sign a player in, to keep game progress, scores and the gamer name with the correct account, to stop attacks, and to find and fix errors."
3. "We do not use them to contact a person, to show ads, or to build a profile of a person."
4. "This is how we make sure of it. An account keeps no email address, no name and no photo, so we have no way to contact a player. Our database refuses to store them. Names and words that a player types in a game stay on the device. The site has no ad code, and no code that follows a person to other websites. The site has no way to send messages to players. Only the operator and the companies in \"Companies that help us run the site\" get these identifiers, and those companies get them only for the uses listed there."

### 7.4 Other lines in #42pr that this change makes false

| Where in #42pr | Old text (start) | New text |
|---|---|---|
| "cookies" data kind, `what`, line 1 | "When a player signs in, the browser keeps a small file (a cookie). It holds the account number, the name, the email address and the picture link..." | "When a player signs in, the browser keeps a small file (a cookie). It holds the account number and the gamer name in a locked (encrypted) form." |
| "network" data kind, first counter item | "We count sign-ups and Retro Arcade downloads by internet address, sign-in tries by email address, and game progress requests and name changes by account." | "We count Retro Arcade downloads by internet address, and game progress requests by account." |
| "network" data kind, error item | "They do not include email addresses, names, passwords, or the words and pictures that players save." | "They do not include the words and pictures that players save." |
| "sharing" section, Google | "Only for players who sign in with Google. Google gives us the name, the email address and the picture link. The profile picture loads from Google's servers." | "Only for players who sign in with Google. Google gives us a sign-in number for the Google account, and nothing else." |
| "rights" section | "Tell us the email address on your child's account." and "we ask you to confirm the request from the email address on the account." | "To see what the account keeps, sign in with your child's Google account and open Profile. It shows the gamer name, the date that the account was made and the game stats. To delete the account and everything in it, tap \"Delete this account\" at the bottom of Profile. To stop all collection, delete the account and do not sign in again: the games still work without an account." (section 2.6) |
| "rights" section, profile item | "It shows the name, the email address, the random player name and the game stats." | "It shows the gamer name, the date that the account was made and the game stats." |
| "safety" section | "We keep passwords only as scrambled codes (bcrypt hashes)." | Delete this item. The site keeps no passwords. |
| "safety" section | "Our server logs leave out email addresses, names, passwords, and..." | "Our server logs leave out the words and pictures that players save." |
| `lib/notice.ts` comment and `SIGN_IN_COOKIE_DAYS` | | No change. A sign-in lasts 30 days from the sign-in (section 4). |

## 8. Limits of the 312.5(c)(7) basis

The exception applies only while an account keeps no other personal
information and the 312.4(d)(3) notice is live (section 2.1). These points
keep it true:

1. Free text in game progress. Before part C, the progress schemas send to
   the account the names that Oregon Trail asks for (#23i), the towns of the
   Weather app, the pet names of Virtual Pet, the beat names of Drum Machine,
   the drawings of Drawing, the wishlist notes of Toy Finder, and the outfit
   words and feeder labels of 4-Wheeler 3D. Part C keeps them on the device
   (`design/LOCAL_WORDS.html`). This is why part A merges after part C. An
   earlier draft of this document said "A first name alone is not personal
   information". That is wrong here: a first name that the site asks a child
   for, stored with the account's identifier, is item (11) of 312.2
   (section 2.5).
2. A new game. Part C adds a test that fails when a progress schema has a
   text field that is not in its reviewed lists (`design/LOCAL_WORDS.html`,
   section 3). A new game cannot add a typed text field without a decision.
3. Fields that the game sets and that still sync. Retro Arcade sends the name
   of a game file that the player loads (`customRoms[].name`,
   `recentlyPlayed[].name`). The player does not type it; it is the file name
   of the game. On 2026-10-02 production had 0 such files.
4. Gameplay clips (#37pr to #44pr) and the privacy notice (#42pr) are on
   other branches. When they merge, they must follow the same rule: nothing
   that a player types or records goes to the account.
5. The rights flow. Section 2.6 gives the way for a parent to see and delete
   the account. #42pr must use the text of section 7.4, because its old text
   confirms a parent by an email address that no longer exists.
