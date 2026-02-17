#!/usr/bin/env node

/**
 * Heuristic to determine whether the license compliance subagent should spawn.
 *
 * Checks if the PR modifies any dependency manifest or lockfile.
 * Outputs JSON: { spawn: boolean, reason: string }
 */

import { ghApi, loadGitHubContext, createLogger } from './lib/github-utils.js';

const logger = createLogger('should-spawn-license-compliance.js');

/**
 * Dependency manifest and lockfile patterns.
 * Basename → ecosystem label used in the reason string.
 */
const MANIFEST_FILES = {
  'package.json': 'npm',
  'pnpm-lock.yaml': 'npm (lockfile)',
  'yarn.lock': 'npm (lockfile)',
  'package-lock.json': 'npm (lockfile)',
  'go.mod': 'Go',
  'go.sum': 'Go (lockfile)',
  'Cargo.toml': 'Rust',
  'Cargo.lock': 'Rust (lockfile)',
  'pyproject.toml': 'Python',
  'setup.py': 'Python',
  'setup.cfg': 'Python',
  'Gemfile': 'Ruby',
  'Gemfile.lock': 'Ruby (lockfile)',
  'composer.json': 'PHP',
  'build.gradle': 'Java/Kotlin',
  'pom.xml': 'Java/Kotlin',
};

/**
 * Additional basename patterns matched via startsWith (e.g. requirements*.txt).
 */
function matchRequirementsTxt(basename) {
  if (basename.startsWith('requirements') && basename.endsWith('.txt')) {
    return 'Python';
  }
  return null;
}

/**
 * Fetch the list of changed files for the current PR.
 * @param {Object} context - GitHub context from loadGitHubContext()
 * @returns {string[]} Array of file paths
 */
export function fetchPrFiles(context) {
  const files =
    ghApi(
      `/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.issue.number}/files`
    ) || [];
  return files.map((f) => f.filename);
}

/**
 * Fetch the labels on the current PR.
 * @param {Object} context - GitHub context from loadGitHubContext()
 * @returns {string[]} Array of label names
 */
export function fetchPrLabels(context) {
  const labels =
    ghApi(
      `/repos/${context.repo.owner}/${context.repo.repo}/issues/${context.issue.number}/labels`
    ) || [];
  return labels.map((l) => l.name);
}

/**
 * Determine whether the license compliance agent should be spawned.
 *
 * @param {string[]} files  - Changed file paths in the PR
 * @param {{ labels?: string[], force?: boolean }} metadata
 * @returns {{ spawn: boolean, reason: string }}
 */
export function shouldSpawnLicenseCompliance(files, metadata = {}) {
  const { labels = [], force = false } = metadata;

  // Force flag always wins
  if (force) {
    return { spawn: true, reason: 'Force flag set' };
  }

  // Skip-review label
  if (labels.includes('skip-review')) {
    return { spawn: false, reason: 'skip-review label present' };
  }

  // Empty / null files
  if (!files || files.length === 0) {
    return { spawn: false, reason: 'No changed files' };
  }

  // Check each file for manifest matches
  const matched = [];

  for (const filePath of files) {
    const basename = filePath.split('/').pop();

    if (MANIFEST_FILES[basename]) {
      matched.push(`${basename} (${MANIFEST_FILES[basename]})`);
      continue;
    }

    const reqMatch = matchRequirementsTxt(basename);
    if (reqMatch) {
      matched.push(`${basename} (${reqMatch})`);
    }
  }

  if (matched.length === 0) {
    return { spawn: false, reason: 'No dependency manifest files changed' };
  }

  return {
    spawn: true,
    reason: `Dependency files changed: ${matched.join(', ')}`,
  };
}

/**
 * CLI entry point — reads context from environment, prints JSON to stdout.
 */
export function main() {
  const context = loadGitHubContext();
  const force =
    (process.env.FORCE_LICENSE_COMPLIANCE_AGENT || '').toLowerCase() === 'true';

  const files = fetchPrFiles(context);
  const labels = fetchPrLabels(context);

  const result = shouldSpawnLicenseCompliance(files, { labels, force });

  logger.log(
    `spawn=${result.spawn} reason="${result.reason}"`
  );

  // Print JSON to stdout for the action step to capture
  process.stdout.write(JSON.stringify(result));
}

// Execute main() only when run directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    // Default to not spawning on error
    process.stdout.write(JSON.stringify({ spawn: false, reason: `Error: ${error.message}` }));
    process.exit(0);
  }
}
