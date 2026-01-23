#!/usr/bin/env node

/**
 * Determines which review subagents to spawn based on PR characteristics.
 * Implements a conservative heuristic that errs on the side of spawning agents.
 */

import { ghApi, loadGitHubContext, createLogger } from "./lib/github-utils.js";

const logger = createLogger("determine-agents");

// All available agents
const ALL_AGENTS = ["bug", "security", "patterns"];

// File pattern matchers
const PATTERNS = {
  docs: /\.(md|txt|rst|mdx)$/i,
  tests: /\.(test|spec)\.[jt]sx?$|__tests__\//i,
  workflows: /\.github\/workflows\/.*\.ya?ml$/,
  auth: /auth|login|session/i,
  sql: /\.sql$|\/migrations\//i,
  secrets: /\.env|secrets?|config\//i,
  infra: /Dockerfile|\.tf$|\.tfvars$/,
  lockfiles: /\.lock$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|go\.sum$/,
  deps: /package\.json$|go\.mod$|requirements\.txt$|Gemfile$/,
};

// Keywords that trigger security agent
const SECURITY_KEYWORDS = [
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "credential",
  "jwt",
  "bearer",
  "crypto",
  "hash",
  "encrypt",
  "decrypt",
  "md5",
  "sha1",
  "exec",
  "spawn",
  "shell",
  "eval",
  "query",
  "sql",
  "fetch",
  "axios",
  "http",
  "redirect",
  "cors",
  "readFile",
  "writeFile",
  "fs\\.",
  "path\\.join",
];

// Keywords that trigger patterns agent
const PATTERNS_KEYWORDS = [
  "walletconnect\\.com",
  "reown\\.com",
  "Cache-Control",
  "max-age",
  "useEffect",
  "useMemo",
  "useCallback",
];

/**
 * Check if a file matches a pattern category
 * @param {string} filename
 * @param {string} category - Key from PATTERNS
 * @returns {boolean}
 */
function matchesPattern(filename, category) {
  return PATTERNS[category]?.test(filename) ?? false;
}

/**
 * Check if patch content contains any keywords from a list
 * @param {string} patch - Diff patch content
 * @param {string[]} keywords
 * @returns {string[]} - Matching keywords found
 */
function findKeywords(patch, keywords) {
  if (!patch) return [];
  const found = [];
  for (const keyword of keywords) {
    const regex = new RegExp(keyword, "i");
    if (regex.test(patch)) {
      found.push(keyword);
    }
  }
  return found;
}

/**
 * Categorize PR files and compute statistics
 * @param {Array<{filename: string, status: string, additions: number, deletions: number, changes: number, patch?: string}>} files
 * @returns {Object}
 */
export function categorizeFiles(files) {
  const codeFiles = files.filter(
    (f) => !matchesPattern(f.filename, "docs") && f.status !== "removed"
  );

  const stats = {
    totalFiles: files.length,
    codeFiles: codeFiles.length,
    totalLines: files.reduce((sum, f) => sum + (f.additions || 0) + (f.deletions || 0), 0),
    maxSingleFileLines: Math.max(
      0,
      ...files.map((f) => (f.additions || 0) + (f.deletions || 0))
    ),

    // Edge case flags
    isEmpty: files.length === 0,
    docsOnly: files.length > 0 && files.every((f) => matchesPattern(f.filename, "docs")),
    testOnly:
      codeFiles.length > 0 &&
      codeFiles.every((f) => matchesPattern(f.filename, "tests")),
    renameOnly:
      files.length > 0 &&
      files.every((f) => f.status === "renamed" && (f.changes || 0) === 0),
    lockfileOnly:
      files.length > 0 && files.every((f) => matchesPattern(f.filename, "lockfiles")),

    // Signal flags
    hasWorkflowFiles: files.some((f) => matchesPattern(f.filename, "workflows")),
    hasAuthFiles: files.some((f) => matchesPattern(f.filename, "auth")),
    hasSqlFiles: files.some((f) => matchesPattern(f.filename, "sql")),
    hasSecretFiles: files.some((f) => matchesPattern(f.filename, "secrets")),
    hasInfraFiles: files.some((f) => matchesPattern(f.filename, "infra")),
    hasDepFiles: files.some((f) => matchesPattern(f.filename, "deps")),
  };

  // Aggregate patches for keyword search
  const allPatches = files
    .map((f) => f.patch || "")
    .filter(Boolean)
    .join("\n");

  stats.securityKeywords = findKeywords(allPatches, SECURITY_KEYWORDS);
  stats.patternsKeywords = findKeywords(allPatches, PATTERNS_KEYWORDS);

  return stats;
}

/**
 * Determine which agents to spawn based on PR characteristics
 * @param {Array<{filename: string, status: string, additions: number, deletions: number, changes: number, patch?: string}>} prFiles
 * @param {{labels?: string[], forceAllAgents?: boolean}} metadata
 * @returns {{agents: string[], reason: string, skipped: string[]}}
 */
export function determineAgents(prFiles, metadata = {}) {
  const { labels = [], forceAllAgents = false } = metadata;

  // Force all agents if requested
  if (forceAllAgents) {
    return {
      agents: [...ALL_AGENTS],
      reason: "Force all agents flag set",
      skipped: [],
    };
  }

  // Check override labels first
  const labelSet = new Set(labels.map((l) => l.toLowerCase()));

  if (labelSet.has("skip-review")) {
    return {
      agents: [],
      reason: "skip-review label present",
      skipped: [...ALL_AGENTS],
    };
  }

  if (labelSet.has("full-review")) {
    return {
      agents: [...ALL_AGENTS],
      reason: "full-review label override",
      skipped: [],
    };
  }

  // Categorize files
  const stats = categorizeFiles(prFiles);

  logger.log(
    `Analyzing PR (${stats.totalFiles} files, ${stats.totalLines} lines changed)`
  );
  logger.log(
    `File signals: hasWorkflowFiles=${stats.hasWorkflowFiles}, hasAuthFiles=${stats.hasAuthFiles}, hasInfraFiles=${stats.hasInfraFiles}`
  );
  logger.log(
    `Content signals: securityKeywords=[${stats.securityKeywords.slice(0, 5).join(", ")}${stats.securityKeywords.length > 5 ? "..." : ""}]`
  );

  // Edge cases - no code to review
  if (stats.isEmpty) {
    return {
      agents: [],
      reason: "Empty PR (no files)",
      skipped: [...ALL_AGENTS],
    };
  }

  if (stats.docsOnly) {
    return {
      agents: [],
      reason: "Docs-only change",
      skipped: [...ALL_AGENTS],
    };
  }

  if (stats.renameOnly) {
    return {
      agents: [],
      reason: "Rename-only change (no content modifications)",
      skipped: [...ALL_AGENTS],
    };
  }

  // Edge cases - limited review
  if (stats.lockfileOnly) {
    return {
      agents: ["security"],
      reason: "Lockfile-only change (supply chain review)",
      skipped: ["bug", "patterns"],
    };
  }

  if (stats.testOnly) {
    return {
      agents: ["bug"],
      reason: "Test-only change",
      skipped: ["security", "patterns"],
    };
  }

  // Large PR → all agents
  if (stats.totalLines > 500 || stats.totalFiles > 15) {
    return {
      agents: [...ALL_AGENTS],
      reason: `Large PR (${stats.totalFiles} files, ${stats.totalLines} lines)`,
      skipped: [],
    };
  }

  // Build agent list based on signals
  const agents = ["bug"]; // Always include bug for code changes
  const reasons = ["Code changes present"];
  const skipped = [];

  // Security agent triggers
  const needsSecurity =
    stats.hasWorkflowFiles ||
    stats.hasAuthFiles ||
    stats.hasSqlFiles ||
    stats.hasSecretFiles ||
    stats.hasInfraFiles ||
    stats.hasDepFiles ||
    stats.securityKeywords.length > 0;

  if (needsSecurity) {
    agents.push("security");
    const secReasons = [];
    if (stats.hasWorkflowFiles) secReasons.push("workflow files");
    if (stats.hasAuthFiles) secReasons.push("auth files");
    if (stats.hasSqlFiles) secReasons.push("SQL/migration files");
    if (stats.hasSecretFiles) secReasons.push("config/secret files");
    if (stats.hasInfraFiles) secReasons.push("infrastructure files");
    if (stats.hasDepFiles) secReasons.push("dependency files");
    if (stats.securityKeywords.length > 0) secReasons.push("security keywords");
    reasons.push(`Security: ${secReasons.join(", ")}`);
  } else {
    skipped.push("security");
  }

  // Patterns agent triggers (conservative: >300 lines single file OR >5 files OR workflow files)
  const needsPatterns =
    stats.hasWorkflowFiles ||
    stats.maxSingleFileLines > 300 ||
    stats.codeFiles > 5 ||
    stats.patternsKeywords.length > 0;

  if (needsPatterns) {
    agents.push("patterns");
    const patReasons = [];
    if (stats.hasWorkflowFiles) patReasons.push("workflow files");
    if (stats.maxSingleFileLines > 300)
      patReasons.push(`large file (${stats.maxSingleFileLines} lines)`);
    if (stats.codeFiles > 5) patReasons.push(`${stats.codeFiles} code files`);
    if (stats.patternsKeywords.length > 0) patReasons.push("patterns keywords");
    reasons.push(`Patterns: ${patReasons.join(", ")}`);
  } else {
    skipped.push("patterns");
  }

  const result = {
    agents,
    reason: reasons.join("; "),
    skipped,
  };

  logger.log(`Decision: Spawning [${agents.join(", ")}]`);
  logger.log(`Reason: ${result.reason}`);
  if (skipped.length > 0) {
    logger.log(`Skipped: [${skipped.join(", ")}]`);
  }

  return result;
}

/**
 * Fetch PR files from GitHub API
 * @param {{repo: {owner: string, repo: string}, issue: {number: number}}} context
 * @returns {Promise<Array>}
 */
export async function fetchPrFiles(context) {
  const { owner, repo } = context.repo;
  const prNumber = context.issue.number;
  const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/files`;

  try {
    const files = ghApi(endpoint);
    return files || [];
  } catch (error) {
    logger.error(`Failed to fetch PR files: ${error.message}`);
    return [];
  }
}

/**
 * Fetch PR labels from GitHub API
 * @param {{repo: {owner: string, repo: string}, issue: {number: number}}} context
 * @returns {Promise<string[]>}
 */
export async function fetchPrLabels(context) {
  const { owner, repo } = context.repo;
  const prNumber = context.issue.number;
  const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}`;

  try {
    const pr = ghApi(endpoint);
    return (pr?.labels || []).map((l) => l.name);
  } catch (error) {
    logger.error(`Failed to fetch PR labels: ${error.message}`);
    return [];
  }
}

/**
 * Main entry point when run as script
 */
async function main() {
  const context = loadGitHubContext();

  if (!context.issue.number) {
    logger.error("No PR number found in context");
    // Return all agents as fallback
    console.log(JSON.stringify({ agents: ALL_AGENTS, reason: "No PR context", skipped: [] }));
    process.exit(0);
  }

  // Check for force flag from environment
  const forceAllAgents = process.env.FORCE_ALL_AGENTS === "true";

  const [files, labels] = await Promise.all([
    fetchPrFiles(context),
    fetchPrLabels(context),
  ]);

  const result = determineAgents(files, { labels, forceAllAgents });

  // Output as JSON for consumption by action.yml
  console.log(JSON.stringify(result));
}

// Execution guard for direct invocation
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("determine-agents.js")
) {
  main().catch((error) => {
    logger.error(`Fatal error: ${error.message}`);
    // Return all agents as fallback on error
    console.log(
      JSON.stringify({ agents: ALL_AGENTS, reason: "Error fallback", skipped: [] })
    );
    process.exit(0);
  });
}
