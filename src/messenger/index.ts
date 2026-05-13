import type { MessengerAdapter } from "./base.js";

// Lazy imports to avoid loading all platform SDKs at startup
const adapterLoaders: Record<string, () => Promise<MessengerAdapter>> = {
  async discord() {
    const { DiscordAdapter } = await import("./discord-adapter.js");
    return new DiscordAdapter();
  },
  async slack() {
    const { SlackAdapter } = await import("./slack-adapter.js");
    return new SlackAdapter();
  },
};

/** Telegram was removed in v0.2.4. Helps users with old `MESSENGER=telegram` get a clear message. */
const REMOVED_PLATFORMS: Record<string, string> = {
  telegram:
    "Telegram support was removed in v0.2.4. Set MESSENGER=discord or MESSENGER=slack in .solosquad/.env and restart.",
};

function resolvePlatform(raw: string | undefined): string {
  const first = (raw || "discord").split(",")[0].trim().toLowerCase();
  return first || "discord";
}

async function createSingle(platform: string): Promise<MessengerAdapter> {
  const loader = adapterLoaders[platform];
  if (!loader) {
    const removed = REMOVED_PLATFORMS[platform];
    if (removed) throw new Error(removed);
    throw new Error(
      `Unsupported messenger platform: ${platform}. Supported: discord, slack.`
    );
  }
  return loader();
}

/** Create a single adapter from MESSENGER env var (v0.2.0+ enforces single platform). */
export async function createAdapter(platform?: string): Promise<MessengerAdapter> {
  const p = resolvePlatform(platform || process.env.MESSENGER);
  return createSingle(p);
}

/**
 * Returns a single-element adapter array (v0.2.0+ enforces one messenger per
 * workspace). Kept as an array-returning function so existing callers
 * `adapters.map(a => a.startBot(...))` don't need changes; the multi-platform
 * comma syntax is collapsed to the first value with a warning.
 */
export async function createAdapters(platforms?: string): Promise<MessengerAdapter[]> {
  const raw = platforms || process.env.MESSENGER || "discord";
  if (raw.includes(",")) {
    console.log(
      `[Bot] MESSENGER contains multiple values ("${raw}"). v0.2.0+ supports one messenger per workspace — using "${resolvePlatform(raw)}".`
    );
  }
  return [await createSingle(resolvePlatform(raw))];
}
