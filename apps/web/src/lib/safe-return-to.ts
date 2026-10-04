/** Login redirects may only stay on this origin, including after URL normalization. */
export function safeReturnTo(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}
