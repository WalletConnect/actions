#!/usr/bin/env node

/**
 * Determine whether the data classification subagent should be spawned
 * based on PR file patterns, patch content keywords, and labels.
 *
 * Outputs JSON: { spawn: boolean, reason: string }
 */

import { ghApi, loadGitHubContext, createLogger } from './lib/github-utils.js';

const logger = createLogger('should-spawn-data-classification.js');

// ---- File pattern triggers ------------------------------------------------

const FILE_PATTERNS = {
  infrastructure: /\.tf$|\.tfvars$/,
  kubernetesHelm: /\.(ya?ml)$/i,
  cloudformation: /cloudformation|cfn/i,
  envSecrets: /(^|\/)\.env|secret|credential/i,
  dbSchema: /migration|schema|model/i,
  apiRoutes: /routes?\.[jt]sx?$|controllers?\.[jt]sx?$|handlers?\.[jt]sx?$|middleware\.[jt]sx?$|api\//i,
};

/**
 * Check if a Kubernetes/Helm YAML is actually infra-related by path context.
 * Generic .yml files (like CI workflows) should not trigger — only k8s/helm paths.
 */
function isKubernetesOrHelmYaml(filePath) {
  return /k8s|kubernetes|helm|chart|deploy|manifests?/i.test(filePath);
}

// ---- Patch keyword triggers -----------------------------------------------

const SENSITIVE_KEYWORDS = [
  // Secrets
  'password',
  'secret',
  'api_key',
  'apiKey',
  'private_key',
  'privateKey',
  'credential',
  'token',
  // Crypto
  'encrypt',
  'decrypt',
  'kms',
  'KMS',
  'AES',
  'TLS',
  // PII
  'email',
  'phone',
  'ssn',
  'date_of_birth',
  'dateOfBirth',
  'personal',
  'pii',
  'gdpr',
  // Logging with sensitive terms (partial — full check done in combination)
  'console\\.log',
  'logger\\.',
  'log\\.',
  'logging',
];

const KEYWORD_REGEX = new RegExp(SENSITIVE_KEYWORDS.join('|'), 'i');

// ---- Skip conditions ------------------------------------------------------

const DOCS_ONLY_REGEX = /\.(md|txt|rst|adoc)$/i;
const TEST_ONLY_REGEX = /(\/__tests__\/|\.test\.|\.spec\.|test\/|tests\/|__mocks__\/)/i;

// ---- Core decision function -----------------------------------------------

/**
 * Determine whether the data classification agent should be spawned.
 *
 * @param {Array} files - PR file objects from GitHub API (filename, status, patch)
 * @param {Object} metadata - Additional metadata
 * @param {string[]} [metadata.labels] - PR label names
 * @param {boolean} [metadata.force] - Force spawn regardless of heuristic
 * @returns {{ spawn: boolean, reason: string }}
 */
export function shouldSpawnDataClassification(files, metadata = {}) {
  const { labels = [], force = false } = metadata;

  // Force override — always wins
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

  // Check if all files are test-only
  const allTests = files.every(f => TEST_ONLY_REGEX.test(f.filename));
  if (allTests) {
    return { spawn: false, reason: 'All files are test-only' };
  }

  // Collect trigger reasons
  const reasons = [];
  const patternHits = new Set();
  let hasKeywordHits = false;

  for (const file of files) {
    const { filename, patch } = file;

    if (FILE_PATTERNS.infrastructure.test(filename)) patternHits.add('Terraform/IaC files');
    if (FILE_PATTERNS.kubernetesHelm.test(filename) && isKubernetesOrHelmYaml(filename)) {
      patternHits.add('Kubernetes/Helm configs');
    }
    if (FILE_PATTERNS.cloudformation.test(filename)) patternHits.add('CloudFormation templates');
    if (FILE_PATTERNS.envSecrets.test(filename)) patternHits.add('environment/secret files');
    if (FILE_PATTERNS.dbSchema.test(filename)) patternHits.add('database/schema files');
    if (FILE_PATTERNS.apiRoutes.test(filename)) patternHits.add('API route/handler files');

    if (patch && KEYWORD_REGEX.test(patch)) hasKeywordHits = true;
  }

  if (patternHits.size > 0) reasons.push(...patternHits);
  if (hasKeywordHits) reasons.push('sensitive data keywords in patch');

  if (reasons.length > 0) {
    return { spawn: true, reason: reasons.join(', ') };
  }

  return { spawn: false, reason: 'No data classification signals detected' };
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

  const force = process.env.FORCE_DATA_CLASSIFICATION_AGENT === 'true';
  const files = fetchPrFiles(context);
  const labels = fetchPrLabels(context);

  const result = shouldSpawnDataClassification(files, { labels, force });

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
