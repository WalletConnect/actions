/**
 * Shared GitHub utilities for Claude auto-review scripts
 */

import { spawnSync } from "child_process";
import fs from "fs";

/**
 * Create a logger with a script name prefix
 * @param {string} scriptName - Name of the script to use as prefix
 * @returns {Object} Logger object with log and error methods
 */
export function createLogger(scriptName) {
  const prefix = `[${scriptName}]`;
  return {
    log: (...args) => console.log(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

/**
 * Execute GitHub CLI API call
 * @param {string} endpoint - API endpoint path
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object|null} data - Request body data
 * @returns {Object|null} Parsed JSON response or null
 */
export function ghApi(endpoint, method = "GET", data = null) {
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
    throw new Error(
      `Failed to invoke gh CLI: ${result.error.message}. Ensure GitHub CLI is installed and available in PATH.`
    );
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

/**
 * Load GitHub Action context from environment
 * @returns {Object} Context object with repo, issue, and payload
 */
export function loadGitHubContext() {
  const repository = process.env.GITHUB_REPOSITORY || "";
  const [owner = "", repo = ""] = repository.split("/");

  let payload = {};
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    } catch (error) {
      createLogger("github-utils.js").error(
        `Unable to parse GitHub event payload: ${error.message}`
      );
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
