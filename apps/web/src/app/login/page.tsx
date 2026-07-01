"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithCredentials, signInWithGoogle } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signInWithCredentials(email, password);

      if (result?.error) {
        setError("Invalid email or password");
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

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      await signInWithGoogle("/");
    } catch {
      setError("Google login failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-400 to-blue-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            Welcome Back!
          </h1>
          <p className="text-gray-600">
            Sign in to save your game progress
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-error mb-6">
            <span>{error}</span>
          </div>
        )}

        {/* Google Login Button - Big and prominent for kids */}
        <button
          onClick={handleGoogleLogin}
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
          {loading ? "Signing in..." : "Continue with Google"}
        </button>

        {/* Divider */}
        <div className="divider text-gray-400">or use email</div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
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
              placeholder="Your password"
              className="input input-bordered input-lg w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-lg w-full mt-6"
          >
            {loading ? (
              <span className="loading loading-spinner" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Sign Up Link */}
        <p className="text-center mt-6 text-gray-600">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary font-bold hover:underline">
            Sign Up
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
