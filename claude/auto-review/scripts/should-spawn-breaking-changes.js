#!/usr/bin/env node

/**
 * Determine whether the breaking changes subagent should be spawned
 * based on PR file metadata, labels, and patch content.
 *
 * Outputs JSON: { spawn: boolean, reason: string }
 */

import { ghApi, loadGitHubContext, createLogger } from './lib/github-utils.js';

const logger = createLogger('should-spawn-breaking-changes.js');

// File path patterns that suggest possible breaking changes
const PATTERNS = {
  actionYml: /action\.ya?ml$/i,
  workflows: /\.github\/workflows\/.*\.ya?ml$/,
  packageEntry: /package\.json$|go\.mod$|setup\.py$|pyproject\.toml$|Cargo\.toml$/,
  typeDefinitions: /\.d\.ts$|types?\.(ts|js)$|interfaces?\.(ts|js)$/i,
  apiRoutes: /routes?\.[jt]sx?$|controllers?\.[jt]sx?$|handlers?\.[jt]sx?$|api\//i,
  schema: /schema|migration|\.sql$/i,
};

// Patch content keywords that signal breaking changes
const KEYWORDS = [
  "inputs:",
  "outputs:",
  "required:",
  "default:",
  "deprecated",
  "export\\s+(?:default\\s+)?(?:function|class|const|interface|type|enum)",
  "module\\.exports",
  "\"main\"",
  "\"exports\"",
  "\"bin\"",
  "\"engines\"",
  "\"peerDependencies\"",
];

const KEYWORD_REGEX = new RegExp(KEYWORDS.join("|"), "i");

const DOCS_ONLY_REGEX = /\.(md|txt|rst|adoc)$/i;
const TEST_ONLY_REGEX = /(\/__tests__\/|\.test\.|\.spec\.|test\/|tests\/|__mocks__\/)/i;

/**
 * Analyze PR files and metadata to decide if the breaking changes subagent should spawn.
 *
 * @param {Array} files - PR file objects from GitHub API (filename, status, patch, additions, deletions)
 * @param {Object} metadata - Additional metadata
 * @param {string[]} [metadata.labels] - PR label names
 * @param {boolean} [metadata.force] - Force spawn regardless of heuristic
 * @returns {{ spawn: boolean, reason: string }}
 */
export function shouldSpawnBreakingChanges(files, metadata = {}) {
  const { labels = [], force = false } = metadata;

  // Skip conditions
  if (labels.includes('skip-review')) {
    return { spawn: false, reason: 'skip-review label present' };
  }

  // Force override
  if (force) {
    return { spawn: true, reason: 'forced via input' };
  }

  if (!files || files.length === 0) {
    return { spawn: false, reason: 'No files in PR' };
  }

  // Label-based triggers override docs/test-only skips
  if (labels.includes('breaking') || labels.includes('breaking-change')) {
    return { spawn: true, reason: 'breaking label' };
  }

  // Check if all files are docs-only
  const allDocs = files.every(f => DOCS_ONLY_REGEX.test(f.filename));
  if (allDocs) {
    return { spawn: false, reason: 'All files are documentation-only' };
  }

  // Check if all files are test-only
  const allTests = files.every(f => TEST_ONLY_REGEX.test(f.filename));
  if (allTests) {
    return { spawn: false, reason: 'All files are test-only' };
  }

  // Collect trigger reasons
  const reasons = [];

  // Pattern-based triggers
  const patternHits = new Set();
  let hasRemovedFiles = false;
  let hasKeywordHits = false;

  for (const file of files) {
    const { filename, status, patch } = file;

    if (PATTERNS.actionYml.test(filename)) patternHits.add('action.yml files');
    if (PATTERNS.workflows.test(filename)) patternHits.add('workflow files');
    if (PATTERNS.packageEntry.test(filename)) patternHits.add('package manifests');
    if (PATTERNS.typeDefinitions.test(filename)) patternHits.add('type definitions');
    if (PATTERNS.apiRoutes.test(filename)) patternHits.add('API routes');
    if (PATTERNS.schema.test(filename)) patternHits.add('schema/migration files');

    if (status === 'removed') hasRemovedFiles = true;

    if (patch && KEYWORD_REGEX.test(patch)) hasKeywordHits = true;
  }

  if (patternHits.size > 0) reasons.push(...patternHits);
  if (hasRemovedFiles) reasons.push('removed files');
  if (hasKeywordHits) reasons.push('breaking change keywords in patch');

  if (reasons.length > 0) {
    return { spawn: true, reason: reasons.join(', ') };
  }

  return { spawn: false, reason: 'No breaking change signals detected' };
}

/**
 * Fetch PR files from GitHub API
 * @param {Object} context - GitHub context
 * @returns {Array} PR files
 */
export function fetchPrFiles(context) {
  return ghApi(
    `/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/files`
  ) || [];
}

/**
 * Fetch PR labels from GitHub API
 * @param {Object} context - GitHub context
 * @returns {string[]} Label names
 */
export function fetchPrLabels(context) {
  const labels = ghApi(
    `/repos/${context.repo.owner}/${context.repo.repo}/issues/${context.issue.number}/labels`
  ) || [];
  return labels.map(l => l.name);
}

/**
 * Main entry point
 */
export function main() {
  const context = loadGitHubContext();

  if (!context.issue.number) {
    const result = { spawn: false, reason: 'Not a pull request event' };
    console.log(JSON.stringify(result));
    return result;
  }

  const force = process.env.FORCE_BREAKING_CHANGES_AGENT === 'true';
  const files = fetchPrFiles(context);
  const labels = fetchPrLabels(context);

  const result = shouldSpawnBreakingChanges(files, { labels, force });

  logger.log(`Decision: spawn=${result.spawn}, reason="${result.reason}"`);
  console.log(JSON.stringify(result));

  return result;
}

// Execute main() only when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    console.log(JSON.stringify({ spawn: false, reason: `Error: ${error.message}` }));
    process.exit(0);
  }
}
