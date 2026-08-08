export const CACHE_PROFILES = ["controlled", "packaged"] as const;

export type CacheProfile = (typeof CACHE_PROFILES)[number];

export const DEFAULT_CACHE_PROFILE: CacheProfile = "controlled";

export function parseCacheProfile(raw: string | undefined): CacheProfile {
  if (raw == null) return DEFAULT_CACHE_PROFILE;
  if (CACHE_PROFILES.includes(raw as CacheProfile)) {
    return raw as CacheProfile;
  }
  throw new Error(
    `--cache-profile must be controlled|packaged (received ${JSON.stringify(raw)})`,
  );
}
