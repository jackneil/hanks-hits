# Hank's Hits — Framework Roadmap (researched ideas)

Ideas for evolving the **kid-builds-games-by-talking-to-Claude** framework, grounded in prior art (Scratch/MIT, Roblox, MakeCode, Rosebud AI), learning science (Resnick, Papert, the INSEAD AI-reliance study), and child-safety guidance (FTC COPPA 2025, UK Children's Code, 5Rights, Common Sense Media). Sources at the bottom.

This is a sibling to `GAME_IDEAS.md` (which is per-game ideas); this file is about the **framework/skills/mechanisms** themselves. Not yet built — a prioritized backlog.

---

## 🎯 Top do-next (highest leverage)

1. **`my-creations` skill** — a private, local gallery of the kid's OWN games (the #1 missing stickiness surface; cheap, zero exposure risk).
2. **`remix-a-game` skill** — copy an existing working game into a new id and re-theme it; make "start from one you love" the default, never a blank page (most-cited mechanism in the research; >25% of Scratch projects are remixes).
3. **`oops-go-back` undo + pre-edit checkpoint in `change-a-game`** — kids can fearlessly try a change and revert (forgiving/undo is a core engagement hook).
4. **Teach a little while building (keep it LIGHT)** — narrate what changed + *why* in kid words ("we made the number bigger so the truck goes faster") so they learn as they play. Never withhold help or slow the fun to "force learning."
5. **CLAUDE.md "talk-to-a-non-reader" block + read-aloud option** — branch on Player Card age; 6–8yos are emergent readers and text-only is an accessibility fail.
6. **In-app "My Games" shelf** — separate the kid's creations from the 24 built-ins on the home page, with personal-best stats.
7. **Lean INTO the fun mechanics** — coins, points, high scores, achievements, badges, streaks, unlockables, and **friend leaderboards** for building *and* playing. Kids love them; let them invent their own achievements and compete with friends. Build on the leaderboards we already have. (Only real line: no real-money purchases / predatory lootboxes.)
8. **Real safety on publishing** — don't expose a specific kid's identity to strangers: unguessable/revocable share URL (not a guessable id that lets anyone enumerate kids' games), generic `og:title` (no "Hank, age 8" card), and treat in-game typed text as PII. (Extends the publish PII scrub + under-13 gate we already built.)

---

## Recommendations (by priority)

### HIGH

| Idea | Kind | Effort | Maps to |
|---|---|---|---|
| **`my-creations` skill** — "show me my games" → a friendly visual menu of the kid's OWN games (scan `src/games`/`src/apps` for a player-authored marker), pick one to play/change/publish. Their trophy shelf, not the full catalog. | new-skill | small | `.claude/skills/my-creations/SKILL.md`; hands off to play/change/put-it-online |
| **`remix-a-game` skill** — "make one like my truck game but dinosaurs" → COPY a working game's island into a new id + re-theme. From-scratch becomes the fallback. | new-skill | medium | `.claude/skills/remix-a-game/SKILL.md` (reuses make-a-game plumbing); cross-link from make-a-game Step 0 + game-ideas |
| **`oops-go-back` undo + checkpoint** — auto-save the game folder's prior state before any edit; "undo that" / "I liked it better" restores it, in kid words. | new-skill | medium | `.claude/skills/oops-go-back/SKILL.md`; pre-edit checkpoint in change-a-game Step 3 (scoped to the one island, never `git add -A`) |
| **"talk-to-a-non-reader" behavior** — age ≤8 (or on request): one short sentence at a 1st–3rd-grade level, emoji/either-or over paragraphs, offer to read instructions aloud (`say` / browser TTS). No important instruction text-only. | claude-behavior | small | CLAUDE.md (new subsection); play-my-game; branches on about-me age/ageAsOf |
| **Teach a little while building (keep it light)** — narrate what changed + *why* in kid words, maybe a quick predict-or-pick question. Helps them learn while they play. NOT a reason to withhold help or slow the fun. | claude-behavior | small | CLAUDE.md (we already have "drop ONE nugget"); light-touch in make-a-game / change-a-game |

### MEDIUM

| Idea | Kind | Effort | Maps to |
|---|---|---|---|
| **`im-stuck` skill** — distinct from game-ideas: "I don't get it"/"it won't work"/"help" → calm one-step-at-a-time hand, reframe breakage as normal/fixable, ONE just-in-time hint (fading as the kid succeeds), route to change/play. | new-skill | small | `.claude/skills/im-stuck/SKILL.md`; disambiguate triggers vs getting-started |
| **`make-it-mine` (sprite + sound helper)** — "make MY truck"/"add a boom" → generate/edit simple SVG/canvas sprites + wire real Web Audio sounds into the game's island. Curated kid-safe kit first, generate only when needed. | new-skill | large | `.claude/skills/make-it-mine/SKILL.md`; writes into the game's island; reuses change-a-game gates |
| **In-app "My Games" shelf** — localStorage list of authored/remixed games (id/name/emoji/createdAt/lastPlayed) as a top home-page section above the built-ins, with personal-best stats. | app-mechanism | medium | `HomeClient.tsx` + `game-registry.ts` (author/origin flag); reads existing Zustand progress |
| **Achievements, coins & friend leaderboards** — fun rewards for building AND playing (1st game, high scores, beat-your-friend), confetti + unlockables; let kids add their own achievements and compete. Extend the leaderboards we already have. Only real line: no real-money / predatory lootboxes. | app-mechanism | medium | extend existing leaderboards + profile; new `shared/lib/achievements.ts` |
| **Harden publish share artifact** — unguessable URL token (not kid-name/sequential id), generic `og:title` ("A game made on Hank's Hits"), and a parent "turn it off"/unpublish path. | skill-tweak | medium | put-it-online (token step, og check in Step 2.5, unpublish path); layout.tsx og:title; route slug gen |
| **Free-text-in-games PII guard** — any text a kid types INTO a game (title/label/sign/NPC speech/high-score name) gets about-me-style PII rules: length-limited, never school/town/last-name even if volunteered, re-scanned at publish. | skill-tweak | small | make-a-game + change-a-game guardrails; reinforced by put-it-online Step 2.5 |
| **"wide-walls" variety nudge** — when seeding ideas / picking a game kind, span genuinely DIFFERENT kinds (reflex / building-toy / story-joke / music-toy) anchored to Player Card interests, not 20 reskins of one platformer. | skill-tweak | small | game-ideas (seed from interests, span kinds); make-a-game Step 2 variety check |

---

## 🔑 Key research insights (the ones worth keeping)

- **Remix beats the blank page.** "The blank canvas is paralyzing for a child; remixing gives an instant working thing to tweak and a fast win." >25% of Scratch projects are remixes. → remix-a-game.
- **Aim for variety in what kids make** (Resnick's "wide walls"): if every game is the same coin-collector reskin, offer genuinely different *kinds* of things too. → variety nudge.
- **The game IS its own error message.** Kids can't read stack traces but absolutely know when a game *feels wrong or isn't fun* — imprecise instructions produce visibly-wrong behavior they self-diagnose. This is why games sustain iteration.
- **6–8yos are emergent readers** — every important instruction should also work via icon/color/animation/voice, not text alone. → non-reader behavior.
- **Teach a little as you build** so kids pick things up — narrate the *why* in kid words. Keep it light; never withhold help or slow the fun.
- **Real safety on publishing (the kind worth doing):** don't expose a specific kid's identity to strangers — no guessable/sequential share IDs that let anyone enumerate kids' games, no share card that says "Hank, age 8", and treat free-text a kid types into a game (titles/labels/signs) like PII. Already partly done via the publish PII scrub + under-13 gate.
- **Stay scoped to building games.** A kid-facing build chat should keep doing its job and not drift into companion/therapy/advice territory.

> **Deliberately CUT from the original synthesis:** the "no coins / no streaks / no leaderboards / intrinsic-rewards-only" stance. Kids love those mechanics and they're core fun — **build them** (see CLAUDE.md "Make it FUN first"). Be reasonably cautious about real harms, not pop-psychology ones.

---

## Sources

- Resnick — Designing for Wide Walls: https://mres.medium.com/designing-for-wide-walls-323bdb4e7277
- Resnick — Give P's a Chance (Projects, Peers, Passion, Play): https://web.media.mit.edu/~mres/papers/constructionism-2014.pdf
- Remixing & computational thinking (ScienceDirect): https://www.sciencedirect.com/science/article/pii/S2666557321000409
- INSEAD — How On-Demand AI Assistance Undermines Learning: https://knowledge.insead.edu/responsibility/how-demand-ai-assistance-undermines-learning
- Rosebud AI — From AI Consumers to AI Builders: https://lab.rosebud.ai/blog/from-ai-consumers-to-ai-builders
- Child-AI Co-Creation: Six Design Considerations (IDC 2025): https://dl.acm.org/doi/10.1145/3713043.3731506
- Lepper/Greene/Nisbett — Overjustification: https://www.academia.edu/14438010/Undermining_childrens_intrinsic_interest_with_extrinsic_reward_A_test_of_the_overjustification_hypothesis
- Points/levels/leaderboards & intrinsic motivation (ACM 2014): https://dl.acm.org/doi/10.1145/2583008.2583017
- Fairplay — Dark Patterns FTC filing: https://fairplayforkids.org/wp-content/uploads/2021/05/darkpatterns.pdf
- FTC — COPPA 2025 amendments: https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data
- UK ICO — Age Appropriate Design Code (Children's Code): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/
- 5Rights — Child Rights by Design (Privacy): https://childrightsbydesign.5rightsfoundation.com/principles/7-privacy/
- Scratch — Parents' & Guardians' Guide: https://medium.com/scratchteam-blog/a-parents-and-guardians-guide-to-scratch-3f0b96e35fc3
- Scratch governance & community moderation (Berkman Klein): https://medium.com/berkman-klein-center/moderation-and-sense-of-community-in-a-youth-oriented-online-platform-scratchs-governance-eeac6941e9c9
- Common Sense Media — AI chatbots unsafe for teen mental-health support: https://www.commonsensemedia.org/press-releases/common-sense-media-finds-major-ai-chatbots-unsafe-for-teen-mental-health-support
- Code.org — Sprite Lab / Game Lab (Piskel editor): https://code.org/en-US/tools/game-lab
- Constructionism (Papert): https://en.wikipedia.org/wiki/Constructionism_(learning_theory)
