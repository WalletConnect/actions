import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  determineAgents,
  categorizeFiles,
  fetchPrFiles,
  fetchPrLabels,
} from "../determine-agents.js";
import { ghApi } from "../lib/github-utils.js";

// Mock ghApi
vi.mock("../lib/github-utils.js", async () => {
  const actual = await vi.importActual("../lib/github-utils.js");
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

describe("categorizeFiles", () => {
  it("should count files and lines correctly", () => {
    const files = [
      { filename: "src/app.ts", additions: 10, deletions: 5 },
      { filename: "src/utils.ts", additions: 20, deletions: 10 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.totalFiles).toBe(2);
    expect(stats.totalLines).toBe(45);
    expect(stats.maxSingleFileLines).toBe(30);
  });

  it("should identify docs-only PRs", () => {
    const files = [
      { filename: "README.md", additions: 10, deletions: 0 },
      { filename: "docs/guide.rst", additions: 5, deletions: 2 },
      { filename: "CHANGELOG.txt", additions: 3, deletions: 1 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.docsOnly).toBe(true);
    expect(stats.testOnly).toBe(false);
  });

  it("should identify test-only PRs", () => {
    const files = [
      { filename: "src/__tests__/app.test.ts", additions: 50, deletions: 10 },
      { filename: "tests/utils.spec.js", additions: 30, deletions: 5 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.testOnly).toBe(true);
    expect(stats.docsOnly).toBe(false);
  });

  it("should identify rename-only PRs", () => {
    const files = [
      { filename: "src/newName.ts", status: "renamed", changes: 0, additions: 0, deletions: 0 },
      { filename: "src/another.ts", status: "renamed", changes: 0, additions: 0, deletions: 0 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.renameOnly).toBe(true);
  });

  it("should identify lockfile-only PRs", () => {
    const files = [
      { filename: "package-lock.json", additions: 100, deletions: 50 },
      { filename: "yarn.lock", additions: 200, deletions: 100 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.lockfileOnly).toBe(true);
  });

  it("should detect workflow files", () => {
    const files = [
      { filename: ".github/workflows/ci.yml", additions: 10, deletions: 0 },
      { filename: "src/app.ts", additions: 5, deletions: 2 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.hasWorkflowFiles).toBe(true);
  });

  it("should detect auth-related files", () => {
    const files = [
      { filename: "src/auth/login.ts", additions: 20, deletions: 5 },
      { filename: "src/session.ts", additions: 10, deletions: 3 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.hasAuthFiles).toBe(true);
  });

  it("should detect SQL/migration files", () => {
    const files = [
      { filename: "db/migrations/001_create_users.sql", additions: 30, deletions: 0 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.hasSqlFiles).toBe(true);
  });

  it("should detect infrastructure files", () => {
    const files = [
      { filename: "Dockerfile", additions: 15, deletions: 5 },
      { filename: "terraform/main.tf", additions: 50, deletions: 10 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.hasInfraFiles).toBe(true);
  });

  it("should detect dependency files", () => {
    const files = [
      { filename: "package.json", additions: 3, deletions: 1 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.hasDepFiles).toBe(true);
  });

  it("should find security keywords in patches", () => {
    const files = [
      {
        filename: "src/api.ts",
        additions: 10,
        deletions: 5,
        patch: `+const token = process.env.API_TOKEN;\n+const result = await fetch(url);`,
      },
    ];

    const stats = categorizeFiles(files);

    expect(stats.securityKeywords).toContain("token");
    expect(stats.securityKeywords).toContain("fetch");
  });

  it("should find patterns keywords in patches", () => {
    const files = [
      {
        filename: "src/component.tsx",
        additions: 20,
        deletions: 5,
        patch: `+useEffect(() => {\n+  // Connect to walletconnect.com\n+}, []);`,
      },
    ];

    const stats = categorizeFiles(files);

    expect(stats.patternsKeywords).toContain("useEffect");
    expect(stats.patternsKeywords).toContain("walletconnect\\.com");
  });

  it("should exclude removed files from code file count", () => {
    const files = [
      { filename: "src/old.ts", status: "removed", additions: 0, deletions: 50 },
      { filename: "src/new.ts", status: "added", additions: 30, deletions: 0 },
    ];

    const stats = categorizeFiles(files);

    expect(stats.codeFiles).toBe(1);
  });
});

describe("determineAgents", () => {
  describe("label overrides", () => {
    it("should skip all agents with skip-review label", () => {
      const files = [{ filename: "src/app.ts", additions: 100, deletions: 50 }];

      const result = determineAgents(files, { labels: ["skip-review"] });

      expect(result.agents).toEqual([]);
      expect(result.skipped).toEqual(["bug", "security", "patterns"]);
      expect(result.reason).toContain("skip-review");
    });

    it("should spawn all agents with full-review label", () => {
      const files = [{ filename: "README.md", additions: 5, deletions: 0 }];

      const result = determineAgents(files, { labels: ["full-review"] });

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
      expect(result.skipped).toEqual([]);
      expect(result.reason).toContain("full-review");
    });

    it("should be case-insensitive for labels", () => {
      const files = [{ filename: "src/app.ts", additions: 10, deletions: 5 }];

      const result = determineAgents(files, { labels: ["FULL-REVIEW"] });

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
    });
  });

  describe("forceAllAgents flag", () => {
    it("should spawn all agents when forceAllAgents is true", () => {
      const files = [{ filename: "README.md", additions: 5, deletions: 0 }];

      const result = determineAgents(files, { forceAllAgents: true });

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
      expect(result.reason).toContain("Force all agents");
    });

    it("should override skip-review label when forceAllAgents is true", () => {
      const files = [{ filename: "src/app.ts", additions: 10, deletions: 5 }];

      const result = determineAgents(files, {
        labels: ["skip-review"],
        forceAllAgents: true,
      });

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
    });
  });

  describe("edge cases", () => {
    it("should skip all agents for docs-only changes", () => {
      const files = [
        { filename: "README.md", additions: 10, deletions: 5 },
        { filename: "docs/guide.md", additions: 20, deletions: 10 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual([]);
      expect(result.reason).toContain("Docs-only");
    });

    it("should skip all agents for rename-only changes", () => {
      const files = [
        { filename: "src/newName.ts", status: "renamed", changes: 0, additions: 0, deletions: 0 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual([]);
      expect(result.reason).toContain("Rename-only");
    });

    it("should only spawn security for lockfile-only changes", () => {
      const files = [
        { filename: "package-lock.json", additions: 500, deletions: 200 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual(["security"]);
      expect(result.reason).toContain("Lockfile-only");
      expect(result.skipped).toContain("bug");
      expect(result.skipped).toContain("patterns");
    });

    it("should only spawn bug for test-only changes", () => {
      const files = [
        { filename: "src/__tests__/app.test.ts", additions: 50, deletions: 10 },
        { filename: "tests/utils.spec.js", additions: 30, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual(["bug"]);
      expect(result.reason).toContain("Test-only");
      expect(result.skipped).toContain("security");
      expect(result.skipped).toContain("patterns");
    });
  });

  describe("large PRs", () => {
    it("should spawn all agents for PRs with >500 lines", () => {
      const files = [
        { filename: "src/big.ts", additions: 300, deletions: 250 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
      expect(result.reason).toContain("Large PR");
      expect(result.reason).toContain("550 lines");
    });

    it("should spawn all agents for PRs with >15 files", () => {
      const files = Array.from({ length: 16 }, (_, i) => ({
        filename: `src/file${i}.ts`,
        additions: 5,
        deletions: 2,
      }));

      const result = determineAgents(files);

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
      expect(result.reason).toContain("Large PR");
      expect(result.reason).toContain("16 files");
    });
  });

  describe("security agent triggers", () => {
    it("should spawn security for workflow files", () => {
      const files = [
        { filename: ".github/workflows/ci.yml", additions: 10, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("security");
      expect(result.reason).toContain("workflow files");
    });

    it("should spawn security for auth-related files", () => {
      const files = [
        { filename: "src/auth/login.ts", additions: 20, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("security");
      expect(result.reason).toContain("auth files");
    });

    it("should spawn security for SQL files", () => {
      const files = [
        { filename: "db/migrations/001.sql", additions: 30, deletions: 0 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("security");
      expect(result.reason).toContain("SQL/migration files");
    });

    it("should spawn security for infrastructure files", () => {
      const files = [
        { filename: "Dockerfile", additions: 15, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("security");
      expect(result.reason).toContain("infrastructure files");
    });

    it("should spawn security for dependency files", () => {
      const files = [
        { filename: "package.json", additions: 3, deletions: 1 },
        { filename: "src/app.ts", additions: 10, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("security");
      expect(result.reason).toContain("dependency files");
    });

    it("should spawn security when security keywords found in patch", () => {
      const files = [
        {
          filename: "src/api.ts",
          additions: 10,
          deletions: 5,
          patch: `+const secret = getSecret();\n+const token = generateToken();`,
        },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("security");
      expect(result.reason).toContain("security keywords");
    });
  });

  describe("patterns agent triggers", () => {
    it("should spawn patterns for workflow files", () => {
      const files = [
        { filename: ".github/workflows/ci.yml", additions: 10, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("patterns");
      expect(result.reason).toContain("workflow files");
    });

    it("should spawn patterns for large single files (>300 lines)", () => {
      const files = [
        { filename: "src/bigfile.ts", additions: 200, deletions: 150 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("patterns");
      expect(result.reason).toContain("large file");
      expect(result.reason).toContain("350 lines");
    });

    it("should spawn patterns for >5 code files", () => {
      const files = Array.from({ length: 6 }, (_, i) => ({
        filename: `src/file${i}.ts`,
        additions: 10,
        deletions: 5,
      }));

      const result = determineAgents(files);

      expect(result.agents).toContain("patterns");
      expect(result.reason).toContain("6 code files");
    });

    it("should spawn patterns when patterns keywords found", () => {
      const files = [
        {
          filename: "src/component.tsx",
          additions: 10,
          deletions: 5,
          patch: `+useEffect(() => { console.log('mounted'); }, []);`,
        },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("patterns");
      expect(result.reason).toContain("patterns keywords");
    });
  });

  describe("small code PRs", () => {
    it("should only spawn bug for trivial code changes", () => {
      const files = [
        { filename: "src/app.ts", additions: 5, deletions: 2 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual(["bug"]);
      expect(result.skipped).toContain("security");
      expect(result.skipped).toContain("patterns");
    });

    it("should include bug but not patterns for medium PR without triggers", () => {
      const files = [
        { filename: "src/app.ts", additions: 50, deletions: 20 },
        { filename: "src/utils.ts", additions: 30, deletions: 10 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("bug");
      expect(result.skipped).toContain("patterns");
    });
  });

  describe("mixed file types", () => {
    it("should apply heuristic to code files when mixed with docs", () => {
      const files = [
        { filename: "README.md", additions: 50, deletions: 20 },
        { filename: "src/auth.ts", additions: 15, deletions: 5 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toContain("bug");
      expect(result.agents).toContain("security");
      expect(result.docsOnly).toBeUndefined(); // Mixed, not docs-only
    });

    it("should detect both security and patterns triggers", () => {
      const files = [
        { filename: ".github/workflows/ci.yml", additions: 10, deletions: 0 },
        { filename: "src/auth/login.ts", additions: 200, deletions: 150 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual(["bug", "security", "patterns"]);
    });
  });

  describe("empty or minimal PRs", () => {
    it("should handle empty file list", () => {
      const result = determineAgents([]);

      expect(result.agents).toEqual([]);
      expect(result.reason).toContain("Empty PR");
      expect(result.skipped).toEqual(["bug", "security", "patterns"]);
    });

    it("should handle files with zero changes", () => {
      const files = [
        { filename: "src/app.ts", additions: 0, deletions: 0 },
      ];

      const result = determineAgents(files);

      expect(result.agents).toEqual(["bug"]);
    });
  });
});

describe("fetchPrFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    repo: { owner: "walletconnect", repo: "test-repo" },
    issue: { number: 123 },
  };

  it("should fetch files from GitHub API", async () => {
    const mockFiles = [
      { filename: "src/app.ts", additions: 10, deletions: 5 },
    ];
    ghApi.mockReturnValue(mockFiles);

    const files = await fetchPrFiles(mockContext);

    expect(ghApi).toHaveBeenCalledWith(
      "/repos/walletconnect/test-repo/pulls/123/files"
    );
    expect(files).toEqual(mockFiles);
  });

  it("should return empty array on error", async () => {
    ghApi.mockImplementation(() => {
      throw new Error("API error");
    });

    const files = await fetchPrFiles(mockContext);

    expect(files).toEqual([]);
  });

  it("should return empty array when API returns null", async () => {
    ghApi.mockReturnValue(null);

    const files = await fetchPrFiles(mockContext);

    expect(files).toEqual([]);
  });
});

describe("fetchPrLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    repo: { owner: "walletconnect", repo: "test-repo" },
    issue: { number: 123 },
  };

  it("should fetch labels from GitHub API", async () => {
    ghApi.mockReturnValue({
      labels: [{ name: "bug" }, { name: "full-review" }],
    });

    const labels = await fetchPrLabels(mockContext);

    expect(ghApi).toHaveBeenCalledWith(
      "/repos/walletconnect/test-repo/pulls/123"
    );
    expect(labels).toEqual(["bug", "full-review"]);
  });

  it("should return empty array on error", async () => {
    ghApi.mockImplementation(() => {
      throw new Error("API error");
    });

    const labels = await fetchPrLabels(mockContext);

    expect(labels).toEqual([]);
  });

  it("should handle PR with no labels", async () => {
    ghApi.mockReturnValue({ labels: [] });

    const labels = await fetchPrLabels(mockContext);

    expect(labels).toEqual([]);
  });

  it("should handle missing labels field", async () => {
    ghApi.mockReturnValue({});

    const labels = await fetchPrLabels(mockContext);

    expect(labels).toEqual([]);
  });
});
