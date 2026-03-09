import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock github-utils before importing the module under test
vi.mock("../lib/github-utils.js", async () => {
  const actual = await vi.importActual("../lib/github-utils.js");
  return {
    ...actual,
    loadGitHubContext: vi.fn(() => ({
      repo: { owner: "test-org", repo: "test-repo" },
      issue: { number: 42 },
      payload: {},
    })),
    createLogger: () => ({
      log: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock child_process
vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { spawnSync } from "child_process";
import fs from "fs";

describe("auto-approve-evaluation", () => {
  let originalEnv;
  let fetchMock;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AUTO_APPROVE_MODEL = "claude-sonnet-4-6";
    process.env.AUTO_APPROVE_SCOPE_PROMPT =
      "Only approve terraform changes that do not destroy resources.";

    // Mock gh pr diff
    spawnSync.mockImplementation((cmd, args) => {
      if (args?.includes("--name-only")) {
        return {
          status: 0,
          stdout: "infrastructure/main.tf\n",
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout:
          '--- a/infrastructure/main.tf\n+++ b/infrastructure/main.tf\n@@ -1 +1 @@\n-old\n+new\n',
        stderr: "",
      };
    });

    // Mock fs
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue("[]");

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("should approve when Claude says approved", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              text: '{"approved": true, "reason": "Safe terraform variable change"}',
            },
          ],
        }),
    });

    const { main } = await import("../auto-approve-evaluation.js");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();

    const output = logSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0]);
        return "approved" in parsed;
      } catch {
        return false;
      }
    });

    expect(output).toBeDefined();
    const result = JSON.parse(output[0]);
    expect(result.approved).toBe(true);
    expect(result.reason).toBe("Safe terraform variable change");

    logSpy.mockRestore();
  });

  it("should reject when Claude says not approved", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              text: '{"approved": false, "reason": "Destructive resource deletion detected"}',
            },
          ],
        }),
    });

    const { main } = await import("../auto-approve-evaluation.js");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();

    const output = logSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0]);
        return "approved" in parsed;
      } catch {
        return false;
      }
    });

    expect(output).toBeDefined();
    const result = JSON.parse(output[0]);
    expect(result.approved).toBe(false);

    logSpy.mockRestore();
  });

  it("should reject when Anthropic API returns an error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal server error"),
    });

    const { main } = await import("../auto-approve-evaluation.js");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // main() throws on API errors — the top-level guard in the file
    // catches this and outputs a reject JSON, but since we call main()
    // directly we need to handle the throw ourselves.
    await expect(main()).rejects.toThrow("Anthropic API 500");

    logSpy.mockRestore();
  });

  it("should reject when Claude response is unparseable", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: "I think this looks good but I'm not sure" }],
        }),
    });

    const { main } = await import("../auto-approve-evaluation.js");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();

    const output = logSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0]);
        return "approved" in parsed;
      } catch {
        return false;
      }
    });

    expect(output).toBeDefined();
    const result = JSON.parse(output[0]);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Failed to parse");

    logSpy.mockRestore();
  });

  it("should include findings from findings.json when available", async () => {
    const findings = [
      {
        id: "test-finding-1",
        severity: "CRITICAL",
        description: "SQL injection",
      },
    ];

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(findings));

    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [
            {
              text: '{"approved": false, "reason": "CRITICAL finding present"}',
            },
          ],
        }),
    });

    const { main } = await import("../auto-approve-evaluation.js");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();

    // Verify the API was called with findings in the message
    const fetchCall = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const userMessage = body.messages[0].content;
    expect(userMessage).toContain("SQL injection");

    logSpy.mockRestore();
  });

  it("should send scope prompt in system message", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: '{"approved": true, "reason": "Looks good"}' }],
        }),
    });

    const { main } = await import("../auto-approve-evaluation.js");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main();

    const fetchCall = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).toContain(
      "Only approve terraform changes that do not destroy resources."
    );

    logSpy.mockRestore();
  });
});
