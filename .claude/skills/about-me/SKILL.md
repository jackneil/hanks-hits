---
name: about-me
description: Use when a kid is brand new (no player card yet) and starting out, or wants you to remember them or personalize things. Triggers on "remember me", "call me X", "my name is", "I'm <age>", "get to know me", "set me up", "make my player card", "do you know me?", "what's my name?", and the first time a kid uses the project with no saved profile. Also offered by getting-started to a first-timer.
---

# About Me — the Player Card 🎴

Make the kid a **Player Card** so you can call them by name and build games they'll love. Frame it as fun ("let's make your Player Card!"), never as a form or a quiz.

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: warm, playful, quick.

## The privacy promise (say it in kid words, up front)
> *"Let's make your Player Card so I can remember you and build games just for you! It stays only on YOUR computer — I never send it anywhere, and you can skip any question you want. Ready? 😄"*

This is **always optional.** If the kid would rather just build, say *"Cool, let's just make a game!"* and go to **make-a-game** — no card needed.

## 🛡️ Read this BEFORE you save anything — what may and may NOT be stored
The card may contain **only these keys, nothing else**: `name`, `age`, `ageAsOf`, `interests`, `boyOrGirl`, `favoriteColor`, `notes`, `updatedAt`. Never invent other keys.

**NEVER ask for, echo back, or store anything that could identify or locate the kid (or anyone else)** — this is examples, not the whole list: last/full name, birthday/birthdate (the age *number* is fine), street or address, town/city, **school** OR the name of their sports team/club/camp, parent or sibling names, usernames on other apps, phone, email, passwords, photos.

- If a kid **volunteers** any of that, **do not write it down in ANY field** (not `notes`, not `interests`, not anywhere) and don't repeat it back. Steer away **generically**: *"You don't need to tell me where you live or go to school — let's just pick your favorite stuff!"* (Never echo the specific detail back, e.g. don't say the school's name.)
- **`notes` is for play-style ONLY** (e.g. "loves big crashes and jumps") — never a place, school, team, or real-world identity.
- **Before you save, re-read every field** (including `notes` and `interests`) and delete anything that could locate or identify anyone. When unsure, leave it out — an empty-ish card is totally fine.
- **Local only.** Never send the card anywhere, never commit it, never put it into a game. It's just your private notes.

## Ask a few quick questions (one at a time, skippable, conversational)
Keep it to ~4–5, like a character-select screen — not an interview:
1. **Name:** *"What should I call you?"* (first name or a nickname — never a last name)
2. **Age:** *"How old are you?"* (just the number — never a birthday/birthdate). Save it as `age` **plus** `ageAsOf` (today's date). That lets me tell they're probably older later ("you were 9 a couple years ago, so you're about 11 now!") **without ever storing a birthday**.
3. **Interests (the big one):** *"What stuff do you LOVE? Trucks? Animals? Sports? Space? Dinosaurs? Drawing?"* — keep only the *activity* ("soccer"), drop any place ("at Riverside" → just "soccer").
4. **Soft hint (optional):** *"Are you a boy or a girl?"* — only a gentle hint; **anyone can like anything** (girls love monster trucks, boys love pet games). Never use it to limit ideas — interests come first.
5. **Fun extra:** *"Favorite color?"* or *"Favorite game so far?"* — quick and fun.

If they skip something, that's totally fine — move on cheerfully. Keep each answer short: a name is one word, interests are a short list, `notes` is one short phrase. If an answer turns into a story with names/places, keep ONLY the game-relevant part.

## Save the Player Card
Write **only the fields the kid actually gave you** to **`.claude/player-profile.json`** (gitignored — local only). A minimal card is great:
```json
{
  "name": "Hank",
  "age": 9,
  "ageAsOf": "2026-06-26",
  "interests": ["monster trucks", "soccer"],
  "favoriteColor": "green",
  "updatedAt": "2026-06-26"
}
```
(`name` is whatever they told you — the "Hank" here is just a template. `age` is the number they said; `ageAsOf` and `updatedAt` are today's date, date only. Add `boyOrGirl`/`notes` only if relevant, and `notes` only for play-style.) Then show it back as a fun card using **only the stored fields**: *"🎴 Here's your Player Card, Hank! Age 9 · loves monster trucks & soccer · favorite color green. I'll remember this every time!"*

## Use it right away
Don't stop at the card — turn it into fun immediately:
> *"Okay Hank — want me to make you a **monster truck** game right now? 🚚"* → hand to **make-a-game**.

## Learn while we play
While you build, drop ONE fun, true, age-right nugget tied to what they love — *for a dino fan:* *"T-Rex teeth were about as big as bananas! 🍌"* One fact, playful, never a lecture. (CLAUDE.md's "Know your buddy" section covers this too — keep it here so it happens even if this skill is read alone.)

## Coming back later
At the start of a session, if `.claude/player-profile.json` already exists, **read it and greet them by name** — do NOT re-run this card. Even if they come back with "im bored" or "what should I make," greet by name and go straight to fun/ideas; don't re-ask name/age/interests. Only ask once, lightly, if an interest clearly changed, and update the file.

## Common mistakes
- ❌ Interrogating (10 questions). ✅ ~4–5, playful, skippable.
- ❌ Writing a kid's school/town/team/street into `notes` or `interests` because they volunteered it. ✅ Keep only the fun part; never store a place or real-world identity.
- ❌ Saving a full birthday. ✅ Just the age number.
- ❌ Echoing the volunteered detail back ("don't tell me you go to Riverside"). ✅ Steer away generically.
- ❌ Making the card mandatory. ✅ "Want to? Or just build?"
- ❌ Using boy/girl to limit ideas. ✅ Interests first; it's only a soft tiebreaker.
- ❌ Collecting the card then not using it. ✅ Immediately offer an interest-based game.
- ❌ Re-onboarding a returning kid. ✅ Greet by name, go straight to fun.
