#!/usr/bin/env node

/**
 * AI-powered auto-approve evaluation.
 *
 * Calls the Anthropic API with the PR diff, review findings, and a
 * repo-specific scope prompt. Claude decides whether to approve or reject.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY        – Anthropic API key
 *   AUTO_APPROVE_MODEL       – Model to use (default: claude-sonnet-4-6)
 *   AUTO_APPROVE_SCOPE_PROMPT – Repo-specific approval criteria
 *
 * Outputs a JSON object to stdout: { approved: boolean, reason: string }
 */

import fs from "fs";
import { spawnSync } from "child_process";
import { loadGitHubContext, createLogger } from "./lib/github-utils.js";

const logger = createLogger("auto-approve-evaluation.js");

/**
 * Fetch the PR diff via GitHub CLI.
 * @param {number} prNumber
 * @returns {string}
 */
function fetchDiff(prNumber) {
  const result = spawnSync("gh", ["pr", "diff", String(prNumber)], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`gh pr diff failed: ${result.stderr?.trim()}`);
  }
  return result.stdout;
}

/**
 * Fetch the list of changed file names.
 * @param {number} prNumber
 * @returns {string}
 */
function fetchChangedFiles(prNumber) {
  const result = spawnSync(
    "gh",
    ["pr", "diff", String(prNumber), "--name-only"],
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  if (result.status !== 0) {
    throw new Error(`gh pr diff --name-only failed: ${result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}

/**
 * Call the Anthropic Messages API.
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.system
 * @param {string} params.userMessage
 * @returns {Promise<string>} assistant text
 */
async function callAnthropic({ apiKey, model, system, userMessage }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Anthropic API");
  }
  return text;
}

/**
 * Build the system prompt for the evaluation.
 */
function buildSystemPrompt(scopePrompt) {
  return `You are a pull request auto-approve evaluator. Your job is to decide whether a PR should be automatically approved based on the provided criteria.

## Approval Scope & Criteria
${scopePrompt || "No specific scope prompt was provided. Default to conservative: only approve trivial, clearly safe changes."}

## Instructions
1. Review the diff and any findings from the code review.
2. Apply the approval criteria strictly.
3. If there are CRITICAL or HIGH severity findings from the review, you should NOT approve.
4. When in doubt, do NOT approve — a human reviewer can always approve manually.

Respond with ONLY a JSON object (no markdown fences, no extra text):
{"approved": true or false, "reason": "Brief explanation of your decision"}`;
}

/**
 * Build the user message with diff, findings, and file list.
 */
function buildUserMessage({ diff, changedFiles, findings }) {
  // Truncate diff if very large to stay within context limits
  const maxDiffLen = 100_000;
  const truncatedDiff =
    diff.length > maxDiffLen
      ? diff.slice(0, maxDiffLen) + "\n\n... [diff truncated]"
      : diff;

  let message = `## Changed Files\n\`\`\`\n${changedFiles}\n\`\`\`\n\n`;
  message += `## Diff\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n\n`;

  if (findings.length > 0) {
    message += `## Review Findings\n\`\`\`json\n${JSON.stringify(findings, null, 2)}\n\`\`\`\n`;
  } else {
    message += `## Review Findings\nNo issues were found during the code review.\n`;
  }

  return message;
}

// ---- Main execution --------------------------------------------------------

export async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const model = process.env.AUTO_APPROVE_MODEL || "claude-sonnet-4-6";
  const scopePrompt = process.env.AUTO_APPROVE_SCOPE_PROMPT || "";

  const context = loadGitHubContext();
  const prNumber = context.issue.number;

  if (!prNumber) {
    logger.error("Could not determine PR number");
    console.log(
      JSON.stringify({ approved: false, reason: "Could not determine PR number" })
    );
    return;
  }

  logger.log(`Evaluating auto-approve for PR #${prNumber}...`);

  // Gather context
  const diff = fetchDiff(prNumber);
  const changedFiles = fetchChangedFiles(prNumber);

  let findings = [];
  if (fs.existsSync("findings.json")) {
    try {
      findings = JSON.parse(fs.readFileSync("findings.json", "utf8"));
    } catch {
      logger.log("Could not parse findings.json, proceeding without findings");
    }
  }

  // Call Claude
  const system = buildSystemPrompt(scopePrompt);
  const userMessage = buildUserMessage({ diff, changedFiles, findings });

  logger.log(`Calling ${model} for auto-approve evaluation...`);

  const responseText = await callAnthropic({
    apiKey,
    model,
    system,
    userMessage,
  });

  // Parse the response — handle potential markdown fences
  let decision;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON object found in response");
    }
    decision = JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    logger.error(
      `Failed to parse Claude response: ${parseError.message}\nRaw response: ${responseText}`
    );
    decision = {
      approved: false,
      reason: "Failed to parse evaluation response — defaulting to reject",
    };
  }

  // Ensure proper shape
  const result = {
    approved: decision.approved === true,
    reason: decision.reason || "No reason provided",
  };

  logger.log(
    `Decision: ${result.approved ? "APPROVE" : "REJECT"} — ${result.reason}`
  );

  // Output to stdout for the calling step to capture
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    logger.error(`Error during auto-approve evaluation: ${error.message}`);
    console.log(
      JSON.stringify({
        approved: false,
        reason: `Evaluation error: ${error.message}`,
      })
    );
    process.exit(0);
  }
}
