export const RELEASE = {
  id: process.env.NEXT_PUBLIC_HH_RELEASE_ID || "development",
  builtAt: Number(process.env.NEXT_PUBLIC_HH_RELEASE_TIME || "0"),
};
export type Release = typeof RELEASE;

export function isNewerRelease(value: unknown, current: Release): value is Release {
  if (!value || typeof value !== "object") return false;
  const release = value as Release;
  return typeof release.id === "string" && release.id.length <= 100
    && release.id !== current.id && Number.isSafeInteger(release.builtAt)
    && release.builtAt > current.builtAt;
}
