#!/usr/bin/env node

/**
 * Extract findings from Claude's PR review comment and create findings.json
 *
 * This script fetches the latest Claude bot comment from the PR, parses it
 * to extract issues/findings, and outputs them as structured JSON.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ---- Utility helpers -----------------------------------------------------

function ghApi(endpoint, method = "GET", data = null) {
  const args = ["api", endpoint, "--method", method];

  if (data) {
    args.push("--input", "-");
  }

  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: data ? JSON.stringify(data) : undefined,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`Failed to invoke gh CLI: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `gh CLI exited with code ${result.status}${stderr ? `: ${stderr}` : ""}`
    );
  }

  const output = result.stdout?.trim();
  if (!output) return null;

  try {
    return JSON.parse(output);
  } catch (parseError) {
    throw new Error(`Failed to parse gh CLI response: ${parseError.message}`);
  }
}

function loadGitHubContext() {
  const repository = process.env.GITHUB_REPOSITORY || "";
  const [owner = "", repo = ""] = repository.split("/");

  let payload = {};
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    } catch (error) {
      console.error(`Unable to parse GitHub event payload: ${error.message}`);
      throw error;
    }
  }

  // Handle both pull_request events and issue_comment events on PRs
  let pullRequest = payload.pull_request || {};
  let issueNumber = pullRequest.number || 0;

  // For issue_comment events, check if the issue is a PR
  if (!issueNumber && payload.issue) {
    // issue_comment events have issue.pull_request if the issue is a PR
    if (payload.issue.pull_request) {
      issueNumber = payload.issue.number;
      pullRequest = payload.issue;
    }
  }

  const issue = {
    number: issueNumber,
  };

  return {
    repo: { owner, repo },
    issue,
    payload,
  };
}

// ---- Finding extraction --------------------------------------------------

/**
 * Parse Claude's markdown comment to extract findings
 *
 * Expected format:
 * #### Issue N: Title
 * **File:** path/to/file.js:123
 * **Severity:** HIGH/MEDIUM/LOW
 * Description text...
 */
function parseClaudeComment(commentBody) {
  const findings = [];

  // Split by issue headers (#### Issue, #### Issue 1:, etc.)
  const issuePattern = /####\s+Issue\s+\d+[:\s]+([^\n]+)/gi;
  const issues = commentBody.split(issuePattern);

  // Process each issue (skip first element which is text before first issue)
  for (let i = 1; i < issues.length; i += 2) {
    const title = issues[i].trim();
    const content = issues[i + 1] || "";

    const finding = {
      id: null,
      description: title,
      severity: "MEDIUM",
      category: "code_issue",
    };

    // Extract ID if present
    // Format: **ID:** file-slug-semantic-slug-hash
    const idMatch = content.match(/\*\*ID:\*\*\s+([a-z0-9\-]+)/i);
    if (idMatch) {
      finding.id = idMatch[1].trim().toLowerCase();
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

    // Extract recommendation if available
    const recommendationMatch = content.match(/\*\*(?:Recommendation|Fix):\*\*\s+([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i);
    if (recommendationMatch) {
      finding.recommendation = recommendationMatch[1].trim();
    }

    // Extract exploit scenario if available
    const exploitMatch = content.match(/\*\*Exploit Scenario:\*\*\s+([^\n]+(?:\n(?!\*\*)[^\n]+)*)/i);
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
 */
function getLatestClaudeComment(context) {
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
    console.log("No Claude bot review comments found.");
    return null;
  }

  // Get the most recent one
  return claudeComments[claudeComments.length - 1];
}

// ---- Main execution ------------------------------------------------------

function main() {
  console.log("Extracting findings from Claude's PR comment...");

  const context = loadGitHubContext();

  if (!context.issue.number) {
    console.log("Not a pull request event, skipping findings extraction.");
    return;
  }

  // Get the latest Claude comment
  const claudeComment = getLatestClaudeComment(context);

  if (!claudeComment) {
    console.log("No Claude review comment found. Creating empty findings.json.");
    fs.writeFileSync("findings.json", JSON.stringify([], null, 2));
    return;
  }

  console.log(`Found Claude comment from ${claudeComment.created_at}`);

  // Parse the comment to extract findings
  const findings = parseClaudeComment(claudeComment.body);

  console.log(`Extracted ${findings.length} findings from Claude's comment.`);

  if (findings.length > 0) {
    console.log("Sample finding:");
    console.log(JSON.stringify(findings[0], null, 2));
  }

  // Write findings to file
  fs.writeFileSync("findings.json", JSON.stringify(findings, null, 2));
  console.log("Successfully created findings.json");
}

try {
  main();
} catch (error) {
  console.error(`Error extracting findings: ${error.message}`);
  // Create empty findings file so the action doesn't fail
  fs.writeFileSync("findings.json", JSON.stringify([], null, 2));
  process.exit(0); // Exit successfully even on error
}
