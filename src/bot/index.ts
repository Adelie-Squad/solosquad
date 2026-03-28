import path from "path";
import { createAdapters } from "../messenger/index.js";
import { findAgent, loadAgentSkill } from "./agent-router.js";
import { runClaude } from "./claude-runner.js";
import { getReposBase } from "../util/paths.js";
import type { Product } from "../util/config.js";
import type { MessageContext } from "../messenger/base.js";

const MAX_MESSAGE_LENGTH = 4000;

async function handleCommand(
  userInput: string,
  product: Product,
  ctx: MessageContext
): Promise<void> {
  // Input validation
  if (!userInput || userInput.trim().length === 0) return;
  if (userInput.length > MAX_MESSAGE_LENGTH) {
    await ctx.reply(`Message too long (${userInput.length} chars). Max: ${MAX_MESSAGE_LENGTH}.`);
    return;
  }

  const productDir = path.join(getReposBase(), product.slug);

  // Agent routing
  const route = findAgent(userInput);
  let skillContext = "";

  if (route) {
    const [team, agent] = route;
    const skill = loadAgentSkill(team, agent);
    if (skill) {
      skillContext = `\n\n--- Agent Skill ---\n${skill}\n--- End Skill ---\n\n`;
      ctx._agentLabel = ` (${agent})`;
      console.log(`[Bot] Routing: ${userInput.slice(0, 50)}... → ${team}/${agent}`);
    }
  }

  const prompt = skillContext ? `${skillContext}${userInput}` : userInput;
  const result = await runClaude(prompt, productDir);

  if (result) {
    await ctx.reply(result);
  } else {
    await ctx.reply("Failed to generate a response.");
  }
}

export async function startBot(): Promise<void> {
  const adapters = await createAdapters();
  const platforms = adapters.map((a) => a.platform);
  console.log(`[Bot] Starting with adapters: ${platforms.join(", ")}`);

  await Promise.all(adapters.map((a) => a.startBot(handleCommand)));
}
