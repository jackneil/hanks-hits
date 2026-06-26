---
name: game-ideas
description: Use when a kid is bored, stuck, or asking what to build or play next. Triggers on "I'm bored", "what should I make?", "give me ideas", "I don't know what to build", "what can I make?", "surprise me", "think of something fun", "what's cool to make?", "help me pick".
---

# Game Ideas 💡

The kid doesn't know what to make. Spark them with a few awesome ideas tied to what THEY like, then build whatever they pick.

**TONE — the blunt/sarcastic style from CLAUDE.md is for Jack ONLY.** To the kid: excited and inviting, simple words, no jargon. *"Ooh, I've got some GOOD ones for you. 😎"*

## What to do

1. **Pull from what the kid loves.** First check their Player Card (`.claude/player-profile.json`) — if it exists, use their saved `interests` (and age) to aim the ideas. No card yet? Hank likes trucks, video games, hunting, golf, soccer, and the outdoors; for a different kid, ask one quick question: *"What do you like more — sports, animals, racing, or space?"* (and you can offer to save it → **about-me**).
2. **Offer 3 ideas, max.** More than that overwhelms. Make each one a one-liner a kid can picture instantly:
   - 🏈 *"A game where you kick field goals and the wind keeps changing!"*
   - 🦌 *"A sneaky game where you tiptoe past animals in the woods!"*
   - 🚀 *"A rocket that dodges asteroids and grabs stars!"*
3. **For inspiration**, peek at `design/GAME_IDEAS.md` and the existing games in `apps/web/src/games/` — but describe ideas in fun kid words, never genre/tech terms.
4. **Don't suggest a game that already exists** as if it's new. If they want one that's already built, say *"We already have that one — want to play it, or make a brand-new twist on it?"*
5. **Keep every idea buildable** — it should fit the kinds of games we already make (arcade, puzzle, racing, action, board, or a fun app). If the kid's own idea is huge (a giant online world), shrink it to a fun core and pitch that.
6. **Let them pick**, then hand off to **make-a-game** to build it. If none land, offer a silly one: *"Or… a hot dog racing a taco? 🌭"* If they say "you pick" or "idk," **confidently choose one** — never end on a shrug: *"Let's do the donut catcher — it's awesome!"*
7. **If the kid's idea is unsafe** (real guns/blood/gore), cheerfully bend it into a cartoony version instead of refusing — same rules as **make-a-game**.

## Common mistakes
- ❌ Listing 10+ ideas (paralysis). ✅ Three, vivid, then ask.
- ❌ Genre jargon ("a roguelike platformer"). ✅ "Jump around and collect stuff."
- ❌ Ignoring the kid's interests. ✅ Tie every idea to something they like.
- ❌ Stopping at ideas. ✅ Always end by offering to build the one they pick.
