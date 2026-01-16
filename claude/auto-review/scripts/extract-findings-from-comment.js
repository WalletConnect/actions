#!/usr/bin/env node

/**
 * Extract findings from Claude's PR review comment and create findings.json
 *
 * This script fetches the latest Claude bot comment from the PR, parses it
 * to extract issues/findings, and outputs them as structured JSON.
 */

import fs from 'fs';
import { ghApi, loadGitHubContext, createLogger } from './lib/github-utils.js';

const logger = createLogger('extract-findings-from-comment.js');

// ---- Finding extraction --------------------------------------------------

/**
 * Parse Claude's markdown comment to extract findings
 *
 * Expected format:
 * #### Issue N: Title
 * **File:** path/to/file.js:123
 * **Severity:** HIGH/MEDIUM/LOW
 * Description text...
 *
 * @param {string} commentBody - The markdown comment body from Claude
 * @returns {Array} Array of finding objects
 */
export function parseClaudeComment(commentBody) {
  const findings = [];

  // Split by issue headers (#### Issue, #### Issue 1:, etc.)
  const issuePattern = /####\s+Issue\s+\d+[:\s]+([^\n]+)/gi;
  const issues = commentBody.split(issuePattern);

  // Process each issue (skip first element which is text before first issue)
  for (let i = 1; i < issues.length; i += 2) {
    const title = issues[i].trim();
    let content = issues[i + 1] || "";

    // Truncate content at horizontal rule dividers that separate issues from other sections
    const dividerMatch = content.match(/\n---\s*\n/);
    if (dividerMatch) {
      content = content.substring(0, dividerMatch.index);
    }

    const finding = {
      id: null,
      description: title,
      severity: "MEDIUM",
      category: "code_issue",
    };

    // Extract ID if present
    // Format: **ID:** file-slug-semantic-slug-hash
    // Multi-agent format: **ID:** {agent-prefix}-file-slug-semantic-slug-hash (bug-, sec-, pat-)
    const idMatch = content.match(/\*\*ID:\*\*\s+([a-z0-9\-]+)/i);
    if (idMatch) {
      finding.id = idMatch[1].trim().toLowerCase();

      // Extract agent from ID prefix (bug-, sec-, pat-)
      const agentPrefixMatch = finding.id.match(/^(bug|sec|pat)-/);
      if (agentPrefixMatch) {
        const agentMap = { 'bug': 'review-bugs', 'sec': 'review-security', 'pat': 'review-patterns' };
        finding.agent = agentMap[agentPrefixMatch[1]];
      }
    }

    // Extract file path and line number
    // Format: **File:** path/to/file.js:123
    const fileMatch = content.match(/\*\*File:\*\*\s+([^:\n]+):(\d+)/i);
    if (fileMatch) {
      finding.file = fileMatch[1].trim();
      finding.line = parseInt(fileMatch[2], 10);
    } else {
      // Try alternate format: file.js:123
      const altFileMatch = content.match(/([a-zA-Z0-9_\-\/\.]+\.[a-z]+):(\d+)/);
      if (altFileMatch) {
        finding.file = altFileMatch[1].trim();
        finding.line = parseInt(altFileMatch[2], 10);
      }
    }

    // Extract severity
    const severityMatch = content.match(/\*\*Severity:\*\*\s+(HIGH|MEDIUM|LOW)/i);
    if (severityMatch) {
      finding.severity = severityMatch[1].toUpperCase();
    }

    // Extract category if mentioned
    const categoryMatch = content.match(/\*\*Category:\*\*\s+([^\n]+)/i);
    if (categoryMatch) {
      finding.category = categoryMatch[1].trim();
    }

    // Extract context if available (capture content until next ** field or #### header)
    const contextMatch = content.match(/\*\*Context:\*\*\s+([\s\S]*?)(?=\n\*\*|\n####|$)/i);
    if (contextMatch) {
      finding.context = contextMatch[1].trim();
    }

    // Extract recommendation if available (capture everything including code blocks with blank lines)
    const recommendationMatch = content.match(/\*\*(?:Recommendation|Fix):\*\*\s+((?:(?!(?:\*\*|####)).|\n)*?)(?=\n\n(?:\*\*|####)|$)/is);
    if (recommendationMatch) {
      finding.recommendation = recommendationMatch[1].trim();
    }

    // Extract exploit scenario if available (capture everything including multi-line descriptions)
    const exploitMatch = content.match(/\*\*Exploit Scenario:\*\*\s+((?:(?!(?:\*\*|####)).|\n)*?)(?=\n\n(?:\*\*|####)|$)/is);
    if (exploitMatch) {
      finding.exploit_scenario = exploitMatch[1].trim();
    }

    // If no file was found, try to extract from first line of content
    if (!finding.file) {
      const firstLine = content.split('\n')[0];
      const pathMatch = firstLine.match(/([a-zA-Z0-9_\-\/\.]+\.[a-z]+)/);
      if (pathMatch) {
        finding.file = pathMatch[1].trim();
        finding.line = 1; // Default to line 1 if not specified
      }
    }

    findings.push(finding);
  }

  return findings;
}

/**
 * Find the latest Claude bot comment on the PR
 * @param {Object} context - GitHub context object
 * @returns {Object|null} Latest Claude comment or null if not found
 */
export function getLatestClaudeComment(context) {
  const comments = ghApi(
    `/repos/${context.repo.owner}/${context.repo.repo}/issues/${context.issue.number}/comments`
  ) || [];

  // Find the most recent comment from Claude bot
  const claudeComments = comments.filter(
    (comment) =>
      comment.user?.login === "claude[bot]" &&
      comment.body &&
      // Only consider comments that look like review findings
      (comment.body.includes("Issue") || comment.body.includes("Finding"))
  );

  if (claudeComments.length === 0) {
    logger.log("No Claude bot review comments found.");
    return null;
  }

  // Get the most recent one
  return claudeComments[claudeComments.length - 1];
}

// ---- Main execution ------------------------------------------------------

/**
 * Main entry point for the script
 */
export function main() {
  logger.log("Extracting findings from Claude's PR comment...");

  const context = loadGitHubContext();

  if (!context.issue.number) {
    logger.log("Not a pull request event, skipping findings extraction.");
    return;
  }

  // Get the latest Claude comment
  const claudeComment = getLatestClaudeComment(context);

  if (!claudeComment) {
    logger.log("No Claude review comment found. Creating empty findings.json.");
    fs.writeFileSync("findings.json", JSON.stringify([], null, 2));
    return;
  }

  logger.log(`Found Claude comment from ${claudeComment.created_at}`);

  // Parse the comment to extract findings
  const findings = parseClaudeComment(claudeComment.body);

  logger.log(`Extracted ${findings.length} findings from Claude's comment.`);

  if (findings.length > 0) {
    logger.log("Sample finding:");
    logger.log(JSON.stringify(findings[0], null, 2));
  }

  // Write findings to file
  fs.writeFileSync("findings.json", JSON.stringify(findings, null, 2));
  logger.log("Successfully created findings.json");
}

// Execute main() only when run directly (not when imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    logger.error(`Error extracting findings: ${error.message}`);
    // Create empty findings file so the action doesn't fail
    fs.writeFileSync("findings.json", JSON.stringify([], null, 2));
    process.exit(0); // Exit successfully even on error
  }
}
