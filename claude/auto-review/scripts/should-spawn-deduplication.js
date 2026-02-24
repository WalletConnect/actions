#!/usr/bin/env node

/**
 * Determine whether the deduplication subagent should be spawned
 * based on n-gram Jaccard similarity of newly added files vs existing repo files.
 *
 * Outputs JSON: { spawn: boolean, reason: string, similarPairs: Array }
 */

import fs from 'fs';
import { spawnSync } from 'child_process';
import { ghApi, loadGitHubContext, createLogger } from './lib/github-utils.js';

const logger = createLogger('should-spawn-deduplication.js');

// ---- Constants ------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.7;
const MAX_SIMILAR_PAIRS = 20;
const MAX_REPO_FILES_PER_EXT = 500;
const MIN_FILE_LINES = 5;
const MAX_FILE_LINES = 10000;

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.lock',
]);

const EXCLUDED_DIRS = [
  'node_modules', 'vendor', 'dist', 'build', '.git',
  '__pycache__', '.terraform', '.next', 'coverage', '.cache',
];

const DOCS_ONLY_REGEX = /\.(md|txt|rst|adoc)$/i;
const TEST_ONLY_REGEX = /(\/__tests__\/|\.test\.|\.spec\.|test\/|tests\/|__mocks__\/)/i;

// ---- N-gram / similarity helpers ------------------------------------------

/**
 * Compute character-level n-gram shingles from whitespace-normalized text.
 * @param {string} text - Input text
 * @param {number} n - Shingle size (default 5)
 * @returns {Set<string>}
 */
export function computeNGrams(text, n = 5) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < n) return new Set();
  const grams = new Set();
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.add(normalized.substring(i, i + n));
  }
  return grams;
}

/**
 * Compute Jaccard similarity between two sets.
 * @param {Set<string>} set1
 * @param {Set<string>} set2
 * @returns {number} 0-1
 */
export function jaccardSimilarity(set1, set2) {
  if (set1.size === 0 && set2.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = set1.size <= set2.size ? [set1, set2] : [set2, set1];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = set1.size + set2.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

// ---- Filesystem helpers ---------------------------------------------------

/**
 * List repo files matching a given extension, excluding common non-source dirs.
 * @param {string} extension - File extension including dot (e.g. '.js')
 * @returns {string[]}
 */
export function listRepoFilesByExtension(extension) {
  const excludeArgs = EXCLUDED_DIRS.flatMap(dir => ['-path', `*/${dir}/*`, '-o']);
  // Remove trailing '-o'
  excludeArgs.pop();

  const result = spawnSync('find', [
    '.', '(', ...excludeArgs, ')', '-prune', '-o',
    '-type', 'f', '-name', `*${extension}`, '-print',
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });

  if (result.error || result.status !== 0) return [];

  return result.stdout
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, MAX_REPO_FILES_PER_EXT);
}

// ---- Core decision function -----------------------------------------------

/**
 * Determine whether the deduplication agent should be spawned.
 *
 * @param {Array} files - PR file objects from GitHub API
 * @param {Object} metadata
 * @param {string[]} [metadata.labels]
 * @param {boolean} [metadata.force]
 * @param {Object} options - Injectable content maps for testing
 * @param {Map<string,string>} [options.addedFileContents]
 * @param {Map<string,string>} [options.repoFileContents]
 * @returns {{ spawn: boolean, reason: string, similarPairs: Array<{newFile: string, existingFile: string, similarity: number}> }}
 */
export function shouldSpawnDeduplication(files, metadata = {}, options = {}) {
  const { labels = [], force = false } = metadata;

  // Force override
  if (force) {
    return { spawn: true, reason: 'forced via input', similarPairs: [] };
  }

  // Skip conditions
  if (labels.includes('skip-review')) {
    return { spawn: false, reason: 'skip-review label present', similarPairs: [] };
  }

  if (!files || files.length === 0) {
    return { spawn: false, reason: 'No files in PR', similarPairs: [] };
  }

  // Label trigger — subagent will do its own analysis
  if (labels.includes('deduplication')) {
    return { spawn: true, reason: 'deduplication label', similarPairs: [] };
  }

  // Filter to added files only
  const addedFiles = files.filter(f => f.status === 'added');
  if (addedFiles.length === 0) {
    return { spawn: false, reason: 'No added files in PR', similarPairs: [] };
  }

  // Docs-only / test-only exclusion (across all PR files, not just added)
  const allDocs = files.every(f => DOCS_ONLY_REGEX.test(f.filename));
  if (allDocs) {
    return { spawn: false, reason: 'All files are documentation-only', similarPairs: [] };
  }

  const allTests = files.every(f => TEST_ONLY_REGEX.test(f.filename));
  if (allTests) {
    return { spawn: false, reason: 'All files are test-only', similarPairs: [] };
  }

  // Build content + n-gram maps for added files
  const addedContents = options.addedFileContents || new Map();
  const repoContents = options.repoFileContents || new Map();
  const addedNGrams = new Map();

  for (const file of addedFiles) {
    const ext = extname(file.filename);
    if (BINARY_EXTENSIONS.has(ext)) continue;

    let content = addedContents.get(file.filename);
    if (content === undefined) {
      try {
        content = fs.readFileSync(file.filename, 'utf8');
      } catch {
        continue;
      }
    }

    const lines = content.split('\n').length;
    if (lines < MIN_FILE_LINES || lines > MAX_FILE_LINES) continue;

    addedNGrams.set(file.filename, computeNGrams(content));
  }

  if (addedNGrams.size === 0) {
    return { spawn: false, reason: 'No eligible added files for similarity check', similarPairs: [] };
  }

  const similarPairs = [];

  // Compare added files vs repo files
  const checkedExtensions = new Set();
  for (const [addedPath, addedGrams] of addedNGrams) {
    const ext = extname(addedPath);

    // Discover repo files for this extension (once per extension)
    if (!checkedExtensions.has(ext)) {
      checkedExtensions.add(ext);
      const repoPaths = listRepoFilesByExtension(ext);
      for (const rp of repoPaths) {
        // Normalize ./prefix
        const normalized = rp.startsWith('./') ? rp.slice(2) : rp;
        if (addedNGrams.has(normalized)) continue; // skip self
        try {
          repoContents.set(normalized, fs.readFileSync(rp, 'utf8'));
        } catch {
          // skip unreadable
        }
      }
    }

    for (const [repoPath, repoContent] of repoContents) {
      if (extname(repoPath) !== ext) continue;
      const repoGrams = computeNGrams(repoContent);
      const sim = jaccardSimilarity(addedGrams, repoGrams);
      if (sim >= SIMILARITY_THRESHOLD) {
        similarPairs.push({ newFile: addedPath, existingFile: repoPath, similarity: Math.round(sim * 1000) / 1000 });
      }
    }
  }

  // Compare added files vs each other
  const addedPaths = [...addedNGrams.keys()];
  for (let i = 0; i < addedPaths.length; i++) {
    for (let j = i + 1; j < addedPaths.length; j++) {
      const sim = jaccardSimilarity(addedNGrams.get(addedPaths[i]), addedNGrams.get(addedPaths[j]));
      if (sim >= SIMILARITY_THRESHOLD) {
        similarPairs.push({ newFile: addedPaths[i], existingFile: addedPaths[j], similarity: Math.round(sim * 1000) / 1000 });
      }
    }
  }

  // Sort descending, cap
  similarPairs.sort((a, b) => b.similarity - a.similarity);
  const capped = similarPairs.slice(0, MAX_SIMILAR_PAIRS);

  if (capped.length === 0) {
    return { spawn: false, reason: 'No similar file pairs above threshold', similarPairs: [] };
  }

  const topSim = capped[0].similarity;
  return {
    spawn: true,
    reason: `${capped.length} similar pair(s) found (top similarity: ${topSim})`,
    similarPairs: capped,
  };
}

// ---- Utility --------------------------------------------------------------

function extname(filepath) {
  const idx = filepath.lastIndexOf('.');
  return idx === -1 ? '' : filepath.slice(idx).toLowerCase();
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
    const result = { spawn: false, reason: 'Not a pull request event', similarPairs: [] };
    console.log(JSON.stringify(result));
    return result;
  }

  const force = process.env.FORCE_DEDUPLICATION_AGENT === 'true';
  const files = fetchPrFiles(context);
  const labels = fetchPrLabels(context);

  const result = shouldSpawnDeduplication(files, { labels, force });

  logger.error(`Decision: spawn=${result.spawn}, reason="${result.reason}", pairs=${result.similarPairs.length}`);
  console.log(JSON.stringify(result));

  return result;
}

// Execute main() only when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    console.log(JSON.stringify({ spawn: false, reason: `Error: ${error.message}`, similarPairs: [] }));
    process.exit(0);
  }
}
