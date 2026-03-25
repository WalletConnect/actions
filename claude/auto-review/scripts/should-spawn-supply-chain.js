#!/usr/bin/env node

/**
 * Determine whether the supply-chain security subagent should be spawned
 * based on PR file patterns and patch content indicators.
 *
 * Outputs JSON: { spawn: boolean, reason: string }
 */

import { ghApi, loadGitHubContext, createLogger } from './lib/github-utils.js';

const logger = createLogger('should-spawn-supply-chain.js');

// ---- File pattern triggers ------------------------------------------------

/**
 * Dependency manifest and lockfile basenames.
 */
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'Podfile',
  'Podfile.lock',
  'pubspec.yaml',
  'pubspec.lock',
]);

/**
 * CI/build configuration patterns.
 */
const CI_BUILD_PATTERNS = [
  /^\.github\/workflows\//,
  /(^|\/)Dockerfile/i,
  /(^|\/)docker-compose\.ya?ml$/i,
  /(^|\/)Makefile$/i,
  /(^|\/)Jenkinsfile$/i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)\.circleci\//i,
];

/**
 * Script/build config basenames that could be attack vectors.
 */
const BUILD_SCRIPT_FILES = new Set([
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pnpmrc',
]);

// ---- Patch keyword triggers -----------------------------------------------

const SUSPICIOUS_PATCH_PATTERNS = [
  /eval\s*\(/,
  /new\s+Function\s*\(/,
  /Function\s*\(/,
  /Buffer\.from/,
  /codePointAt/,
  /fromCharCode/,
  /\\x[0-9a-fA-F]{2}/,
  /\\u[0-9a-fA-F]{4}/,
  /preinstall|postinstall|preuninstall/,
];

// ---- Skip conditions ------------------------------------------------------

const DOCS_ONLY_REGEX = /\.(md|txt|rst|adoc)$/i;

// ---- Core decision function -----------------------------------------------

/**
 * Determine whether the supply-chain security agent should be spawned.
 *
 * @param {Array} files - PR file objects from GitHub API (filename, status, patch)
 * @param {Object} metadata - Additional metadata
 * @param {string[]} [metadata.labels] - PR label names
 * @param {boolean} [metadata.force] - Force spawn regardless of heuristic
 * @returns {{ spawn: boolean, reason: string }}
 */
export function shouldSpawnSupplyChain(files, metadata = {}) {
  const { labels = [], force = false } = metadata;

  // Force override
  if (force) {
    return { spawn: true, reason: 'forced via input' };
  }

  // Skip conditions
  if (labels.includes('skip-review')) {
    return { spawn: false, reason: 'skip-review label present' };
  }

  if (!files || files.length === 0) {
    return { spawn: false, reason: 'No files in PR' };
  }

  // Check if all files are docs-only
  const allDocs = files.every(f => DOCS_ONLY_REGEX.test(f.filename));
  if (allDocs) {
    return { spawn: false, reason: 'All files are documentation-only' };
  }

  // Collect trigger reasons
  const reasons = [];
  const triggerHits = new Set();
  let hasSuspiciousPatterns = false;

  for (const file of files) {
    const { filename, patch } = file;
    const basename = filename.split('/').pop();

    // Dependency files
    if (DEPENDENCY_FILES.has(basename)) {
      triggerHits.add('dependency manifest/lockfile changes');
    }

    // CI/build configs
    for (const pattern of CI_BUILD_PATTERNS) {
      if (pattern.test(filename)) {
        triggerHits.add('CI/build configuration changes');
        break;
      }
    }

    // Build script configs
    if (BUILD_SCRIPT_FILES.has(basename)) {
      triggerHits.add('package manager configuration changes');
    }

    // Check patch content for suspicious patterns
    if (patch) {
      for (const pattern of SUSPICIOUS_PATCH_PATTERNS) {
        if (pattern.test(patch)) {
          hasSuspiciousPatterns = true;
          break;
        }
      }
    }
  }

  if (triggerHits.size > 0) reasons.push(...triggerHits);
  if (hasSuspiciousPatterns) reasons.push('suspicious code patterns in patch');

  if (reasons.length > 0) {
    return { spawn: true, reason: reasons.join(', ') };
  }

  return { spawn: false, reason: 'No supply-chain signals detected' };
}

// ---- GitHub API helpers ---------------------------------------------------

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

// ---- CLI entry point ------------------------------------------------------

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

  const force = process.env.FORCE_SUPPLY_CHAIN_AGENT === 'true';
  const files = fetchPrFiles(context);
  const labels = fetchPrLabels(context);

  const result = shouldSpawnSupplyChain(files, { labels, force });

  logger.error(`Decision: spawn=${result.spawn}, reason="${result.reason}"`);
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
