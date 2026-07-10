import Link from "next/link";
import { Header } from "@/shared/components/Header";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="relative flex flex-col items-center justify-center gap-8 overflow-hidden px-6 py-16 text-center">
      {/* Soft glows to match the home page adventure vibe */}
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-500/20 blur-3xl" />
      <div className="pointer-events-none absolute left-1/4 top-2/3 h-[300px] w-[300px] rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="text-8xl animate-bounce-slow md:text-9xl" aria-hidden="true">
        🧭
      </div>

      <h1 className="bg-gradient-to-r from-yellow-300 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-black text-transparent md:text-6xl">
        Oops! This page wandered off!
      </h1>

      <p className="max-w-md text-lg text-white/70 md:text-xl">
        We looked everywhere but could not find it. Let us get you back to the fun!
      </p>

      <Link
        href="/"
        className="inline-flex min-h-[44px] items-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-4 text-xl font-black text-white shadow-lg shadow-cyan-500/30 transition-transform hover:scale-105 active:scale-95 md:text-2xl"
      >
        <span aria-hidden="true">🎮</span>
        Back to Games
      </Link>
      </main>
    </div>
  );
}
