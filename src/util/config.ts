import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getWorkspaceDir, getReposBase } from "./paths.js";
import { normalizeLine } from "./platform.js";

export interface Product {
  name: string;
  slug: string;
  github_org?: string;
}

/** Load .env file into a key-value map. */
export function loadEnv(dir?: string): Record<string, string> {
  const envFile = path.join(dir || getWorkspaceDir(), ".env");
  const env: Record<string, string> = {};
  if (!fs.existsSync(envFile)) return env;

  for (const line of normalizeLine(fs.readFileSync(envFile, "utf-8")).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

/** Save/merge updates into .env file, preserving comments and order. */
export function saveEnv(updates: Record<string, string>, dir?: string): void {
  const envFile = path.join(dir || getWorkspaceDir(), ".env");
  const remaining = { ...updates };
  const lines: string[] = [];

  if (fs.existsSync(envFile)) {
    for (const line of normalizeLine(fs.readFileSync(envFile, "utf-8")).split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
        if (key in remaining) {
          lines.push(`${key}=${remaining[key]}`);
          delete remaining[key];
        } else {
          lines.push(line);
        }
      } else {
        lines.push(line);
      }
    }
  }

  for (const [k, v] of Object.entries(remaining)) {
    lines.push(`${k}=${v}`);
  }

  fs.writeFileSync(envFile, lines.join("\n") + "\n");
}

/** Load products from core/products.json. */
export function loadProducts(dir?: string): Product[] {
  const file = path.join(dir || getWorkspaceDir(), "core", "products.json");
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

/** Save products to core/products.json. */
export function saveProducts(products: Product[], dir?: string): void {
  const file = path.join(dir || getWorkspaceDir(), "core", "products.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(products, null, 2));
}

/** Load messenger config for a product/platform. */
export function loadMessengerConfig(
  productSlug: string,
  platform: string
): Record<string, unknown> {
  try {
    const configFile = path.join(getReposBase(), productSlug, platform, "config.yaml");
    if (!fs.existsSync(configFile)) return {};
    return (yaml.load(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}
