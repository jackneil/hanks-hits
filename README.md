<div align="center">

# 🎮 Hank's Hits 🚚

### Make your OWN video games. No coding. No kidding.

**You dream it up. A robot helper builds it. You play it.** 🤖✨

🏎️ Trucks &nbsp;•&nbsp; 🐍 Snake &nbsp;•&nbsp; 🧱 Brick-breakers &nbsp;•&nbsp; 👾 Space shooters &nbsp;•&nbsp; 🐶 Pet games &nbsp;•&nbsp; 🎨 Whatever YOU want

</div>

---

## 👋 Hi! Want to make a game?

This is a place where **you** are the boss of the games. 🫵

You don't need to know how to code. You don't need to be good at computers. You just say what you want — like *"make a game where a monster truck jumps over school buses"* — and your robot helper builds the **whole thing** for you. Then you play it. 🎉

It's like having a video-game-maker for a best friend.

---

## 🚀 How it works (it's just 3 steps)

> ### 1️⃣ Tell the robot helper what you want
> Say it like you'd say it to a friend:
> *"I want a game where you catch falling donuts."* 🍩

> ### 2️⃣ The robot helper builds it
> It does ALL the hard computer stuff for you. It might ask you a couple of fun questions first, like *"Should the donuts fall fast or slow?"*

> ### 3️⃣ You play it! 🕹️
> When it's done, you get to play your brand-new game. Don't like something? Just say *"make it harder!"* or *"add a dog!"* and it'll change it.

---

## 🗣️ Cool things you can say

Just type these to your robot helper:

- 🆕 **"Make a new game about \_\_\_\_\_"** — and it builds you a whole new game
- 🎮 **"Let me play my game"** — and it shows your game on the screen
- 🔧 **"Make it harder"** or **"add more levels"** — and it changes your game
- 😂 **"My game is broken, help!"** — and it fixes it
- 💡 **"I'm bored, what should I make?"** — and it gives you awesome ideas
- 🌍 **"Put my game on the internet!"** — so your friends can play it too
- ❓ **"What can you do?"** — if you ever feel stuck

---

## 🕹️ Games already in here

There are already a TON of games ready to play. Here are some favorites:

| | | | |
|---|---|---|---|
| 🚚 Monster Truck | ⛰️ Hill Climb | 🐍 Snake | 🧱 Brick Breaker |
| 👾 Space Invaders | ☄️ Asteroids | 🐤 Flappy Bird | 🦖 Dino Runner |
| 🔢 2048 | 🧠 Memory Match | ♟️ Chess | 🔴 Checkers |
| 🍪 Cookie Clicker | 💣 Bomberman | 🏃 Endless Runner | 🟦 Hextris |
| 🐶 Virtual Pet | 🎨 Drawing | 🥁 Drum Machine | 😂 Joke Machine |

…and a bunch more — plus all the new ones **you** make! 🎉

---

## ⭐ The rules (don't worry, they're easy)

- 🟢 **Make as many games as you want.** Go wild!
- 🟢 **Every game is its own little world** — making a new one never breaks your other ones.
- 🟢 **Have fun and be silly.** The best games are the weird ones.
- 🔴 The robot helper keeps everything **safe and kid-friendly**, always.

---

<details>
<summary><h2>👨‍👩‍👧 For grown-ups (and curious big kids): how this actually works</h2></summary>

### What this is

**Hank's Hits** is a Next.js web platform where a child uses **Claude Code** (an AI coding assistant) to design and build their own browser games — no coding knowledge required. The child describes a game in plain words; Claude builds the complete, tested, kid-safe module and can deploy it live.

The "magic" is in two files of guardrails that travel with the repo:
- **`CLAUDE.md`** — tells Claude how to behave with a child (warm tone, no jargon, safety rules, the exact build patterns).
- **`.claude/skills/`** — step-by-step playbooks that auto-activate when the kid says things like "make a game" or "put it online."

### Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS 4 + DaisyUI |
| State / save | Zustand + Postgres (Drizzle ORM) via next-auth |
| 3D games | React Three Fiber + Rapier |
| 2D physics | matter-js |
| Tests | Vitest |
| Hosting | Railway (Docker) — auto-deploys on push to `master` |

### One-time setup on a new computer

A child can't do this part — a grown-up does it **once**:

```bash
# 1. Install Node 20+ and pnpm (https://pnpm.io/installation)
# 2. Install the Claude Code CLI (https://claude.com/claude-code)
# 3. Clone and install:
git clone https://github.com/jackneil/hanks-hits.git
cd hanks-hits
pnpm install

# 4. Run it locally:
cd apps/web
pnpm dev          # open http://localhost:3000
```

To let the child **publish games to the internet**, connect this GitHub repo to a Railway project (Postgres + a web service using the included `Dockerfile`). After that, every push to `master` auto-deploys. If you clone this as a *different* person, point it at **your own** GitHub repo + Railway project.

After setup, hand the keyboard to the kid: they just open Claude Code in this folder and start talking.

### Useful commands

```bash
pnpm --filter web dev      # local dev server
pnpm --filter web test     # run the test suite (Vitest)
pnpm --filter web build    # production build (regenerates game metadata)
```

### How a game is structured

Each game/app is a **self-contained module** under `apps/web/src/games/<name>/` (or `src/apps/<name>/`) with its own `metadata.ts`, Zustand store, `Game.tsx`, route, tests, and a Zod progress schema. The home page auto-discovers games by scanning their `metadata.ts`. Full architecture is in [`design/ARCHITECTURE.md`](design/ARCHITECTURE.md); the exact "add a new game" checklist is in [`CLAUDE.md`](CLAUDE.md).

</details>

---

<div align="center">

### 🎈 Now go make something awesome. 🎈

*Built with ❤️ by Hank — with a little help from a robot.*

</div>
