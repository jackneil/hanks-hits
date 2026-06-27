/**
 * Simple in-memory rate limiter using sliding window algorithm
 *
 * No external dependencies (no Redis). Resets on server restart,
 * but still prevents most abuse during a deployment.
 */

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

// In-memory storage for rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupOldEntries(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  const cutoff = now - windowMs * 2; // Keep entries for 2x the window

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.windowStart < cutoff) {
      rateLimitStore.delete(key);
    }
  }
}

type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
};

/**
 * Check if a request should be rate limited
 *
 * @param key - Unique identifier (IP address, email, etc.)
 * @param limit - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns Result with success flag and remaining requests
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();

  // Periodic cleanup
  cleanupOldEntries(windowMs);

  const entry = rateLimitStore.get(key);

  // No existing entry - create one
  if (!entry) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return {
      success: true,
      remaining: limit - 1,
      resetIn: Math.ceil(windowMs / 1000),
    };
  }

  // Window expired - reset
  if (now - entry.windowStart >= windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return {
      success: true,
      remaining: limit - 1,
      resetIn: Math.ceil(windowMs / 1000),
    };
  }

  // Within window - check limit
  if (entry.count >= limit) {
    const resetIn = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return {
      success: false,
      remaining: 0,
      resetIn,
    };
  }

  // Increment count
  entry.count += 1;
  const resetIn = Math.ceil((entry.windowStart + windowMs - now) / 1000);

  return {
    success: true,
    remaining: limit - entry.count,
    resetIn,
  };
}

// Pre-configured rate limiters

/**
 * Rate limit for signup: 5 requests per minute per IP
 */
export function checkSignupRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`signup:${ip}`, 5, 60 * 1000);
}

/**
 * Rate limit for login: 10 attempts per 15 minutes per email
 * More lenient than signup since users may forget passwords
 */
export function checkLoginRateLimit(email: string): RateLimitResult {
  const normalizedEmail = email.toLowerCase().trim();
  return checkRateLimit(`login:${normalizedEmail}`, 10, 15 * 60 * 1000);
}

/**
 * Rate limit for progress saves: 60 requests per minute per user
 * Generous limit but prevents spam/abuse
 */
export function checkProgressRateLimit(userId: string): RateLimitResult {
  return checkRateLimit(`progress:${userId}`, 60, 60 * 1000);
}

/**
 * Helper to extract IP from request headers
 */
export function getClientIP(request: Request): string {
  // SECURITY: the LEFTMOST X-Forwarded-For entry is fully client-controlled (a
  // client can prepend any value), so it must never key a rate-limit bucket.
  // Prefer x-real-ip, which the trusted Railway edge proxy sets to the real
  // client IP; otherwise take the RIGHTMOST X-Forwarded-For hop — the address
  // the closest trusted proxy actually observed.
  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP.trim();
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  // Fallback - shouldn't happen in production
  return "unknown";
}
