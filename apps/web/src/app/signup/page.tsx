"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithCredentials, signInWithGoogle } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate passwords match
    if (password !== confirmPassword) {
      setError("Passwords don't match!");
      return;
    }

    // Validate password length
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      // Create account via API
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Sign up failed");
        return;
      }

      // Auto sign in after signup
      const signInResult = await signInWithCredentials(email, password);

      if (signInResult?.error) {
        // Account created but sign in failed - redirect to login
        router.push("/login?message=Account created! Please sign in.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError("");
    setLoading(true);

    try {
      await signInWithGoogle("/");
    } catch {
      setError("Google sign up failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-400 to-green-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            Join the Fun!
          </h1>
          <p className="text-gray-600">
            Create an account to save your progress
          </p>
        </div>

        <div className="mb-6 border-l-4 border-green-500 pl-4 text-sm leading-relaxed text-gray-700">
          <p className="font-bold text-gray-800">For grown-ups</p>
          <p>
            Accounts save game progress for this player. Leaderboard scores may
            show the player&apos;s display name. Use a grown-up&apos;s email or
            get permission before creating an account.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-error mb-6">
            <span>{error}</span>
          </div>
        )}

        {/* Google Sign Up Button */}
        <button
          onClick={handleGoogleSignUp}
          disabled={loading}
          className="btn btn-lg w-full gap-3 mb-6 bg-white border-2 border-gray-300 hover:bg-gray-50 text-gray-700"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {loading ? "Creating account..." : "Sign up with Google"}
        </button>

        {/* Divider */}
        <div className="divider text-gray-400">or use email</div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailSignUp} className="space-y-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-lg">Your Name</span>
            </label>
            <input
              type="text"
              placeholder="What should we call you?"
              className="input input-bordered input-lg w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-lg">Email</span>
            </label>
            <input
              type="email"
              placeholder="your@email.com"
              className="input input-bordered input-lg w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-lg">Password</span>
            </label>
            <input
              type="password"
              placeholder="At least 6 characters"
              className="input input-bordered input-lg w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-lg">Confirm Password</span>
            </label>
            <input
              type="password"
              placeholder="Type it again"
              className="input input-bordered input-lg w-full"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-success btn-lg w-full mt-6"
          >
            {loading ? (
              <span className="loading loading-spinner" />
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        {/* Sign In Link */}
        <p className="text-center mt-6 text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-bold hover:underline">
            Sign In
          </Link>
        </p>

        {/* Back to Games Link */}
        <div className="text-center mt-4">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            ← Back to Games
          </Link>
        </div>
      </div>
    </div>
  );
}
