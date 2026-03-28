import fs from "fs";
import path from "path";
import type { RoutineConfig } from "./routines.js";
import { normalizeLine } from "../util/platform.js";

const SENSITIVE_PATTERN = /(?:token|secret|password|api_key|private_key|apikey)\s*[:=]\s*\S+/gi;

/** Redact sensitive patterns from string values. */
function sanitizeForStorage(item: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    cleaned[key] = typeof value === "string"
      ? value.replace(SENSITIVE_PATTERN, "[REDACTED]")
      : value;
  }
  return cleaned;
}

/** Extract JSON blocks from routine results. */
export function extractJsonBlocks(text: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const regex = /```json\s*\n(.*?)\n\s*```/gs;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (typeof obj === "object" && obj !== null && !obj._schema) {
          items.push(obj);
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }
  return items;
}

/** Append items to JSONL file with dedup. */
export function appendToJsonl(
  filePath: string,
  items: Record<string, unknown>[]
): number {
  if (!items.length) return 0;

  const existing = new Set<string>();
  if (fs.existsSync(filePath)) {
    for (const line of normalizeLine(fs.readFileSync(filePath, "utf-8")).split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('{"_schema')) {
        existing.add(trimmed);
      }
    }
  }

  let added = 0;
  const lines: string[] = [];
  for (const item of items) {
    if (!item.date) {
      item.date = new Date().toISOString().slice(0, 10);
    }
    const line = JSON.stringify(sanitizeForStorage(item));
    if (!existing.has(line)) {
      lines.push(line);
      added++;
    }
  }

  if (lines.length) {
    fs.appendFileSync(filePath, lines.join("\n") + "\n");
  }
  return added;
}

/** Extract JSON from routine result and append to JSONL memory. */
export function saveRoutineMemory(
  result: string,
  routine: RoutineConfig,
  productDir: string
): void {
  if (!routine.memoryTargets.length) return;

  const items = extractJsonBlocks(result);
  if (!items.length) return;

  const memoryDir = path.join(productDir, "memory");
  let total = 0;

  for (const target of routine.memoryTargets) {
    const targetPath = path.join(memoryDir, target);
    if (fs.existsSync(targetPath)) {
      total += appendToJsonl(targetPath, items);
    }
  }

  if (total > 0) {
    console.log(
      `[Scheduler] Memory saved: ${total} item(s) → ${routine.memoryTargets.join(", ")}`
    );
  }
}
