import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldSpawnDataClassification, fetchPrFiles, fetchPrLabels } from '../should-spawn-data-classification.js';
import { ghApi } from '../lib/github-utils.js';

vi.mock('../lib/github-utils.js', async () => {
  const actual = await vi.importActual('../lib/github-utils.js');
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

describe('shouldSpawnDataClassification', () => {
  // ---- File pattern triggers ------------------------------------------------

  it('should spawn for Terraform files (.tf)', () => {
    const files = [{ filename: 'infra/main.tf', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Terraform/IaC');
  });

  it('should spawn for Terraform var files (.tfvars)', () => {
    const files = [{ filename: 'infra/vars/prod.tfvars', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Terraform/IaC');
  });

  it('should spawn for Kubernetes YAML files', () => {
    const files = [{ filename: 'k8s/deployment.yaml', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Kubernetes/Helm');
  });

  it('should spawn for Helm chart files', () => {
    const files = [{ filename: 'helm/charts/values.yml', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Kubernetes/Helm');
  });

  it('should not spawn for generic YAML files outside k8s/helm paths', () => {
    const files = [{ filename: 'src/config.yml', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No data classification signals');
  });

  it('should spawn for CloudFormation templates', () => {
    const files = [{ filename: 'infra/cloudformation-stack.json', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('CloudFormation');
  });

  it('should spawn for .env files', () => {
    const files = [{ filename: '.env', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('environment/secret');
  });

  it('should spawn for .env.local files', () => {
    const files = [{ filename: '.env.local', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('environment/secret');
  });

  it('should spawn for files with secret in the name', () => {
    const files = [{ filename: 'config/secrets.json', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('environment/secret');
  });

  it('should spawn for files with credential in the name', () => {
    const files = [{ filename: 'config/credentials.yml', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('environment/secret');
  });

  it('should spawn for migration files', () => {
    const files = [{ filename: 'db/migrations/001_create_users.sql', status: 'added' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('database/schema');
  });

  it('should spawn for schema files', () => {
    const files = [{ filename: 'src/db/schema.prisma', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('database/schema');
  });

  it('should spawn for model files', () => {
    const files = [{ filename: 'src/models/user.ts', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('database/schema');
  });

  it('should spawn for API route files', () => {
    const files = [{ filename: 'src/api/users.ts', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('API route/handler');
  });

  it('should spawn for controller files', () => {
    const files = [{ filename: 'src/users.controller.ts', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('API route/handler');
  });

  it('should spawn for handler files', () => {
    const files = [{ filename: 'src/handlers.js', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('API route/handler');
  });

  it('should spawn for middleware files', () => {
    const files = [{ filename: 'src/middleware.ts', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('API route/handler');
  });

  // ---- Keyword-based triggers -----------------------------------------------

  it('should spawn when patch contains password keyword', () => {
    const files = [{ filename: 'src/auth.ts', status: 'modified', patch: '+  const password = req.body.password;' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains api_key keyword', () => {
    const files = [{ filename: 'src/config.ts', status: 'modified', patch: '+  api_key: "sk-12345"' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains encrypt keyword', () => {
    const files = [{ filename: 'src/crypto.ts', status: 'modified', patch: '+  const encrypted = encrypt(data);' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains PII keyword (email)', () => {
    const files = [{ filename: 'src/user.ts', status: 'modified', patch: '+  const email = user.email;' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains console.log', () => {
    const files = [{ filename: 'src/debug.ts', status: 'modified', patch: '+  console.log(data);' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains KMS keyword', () => {
    const files = [{ filename: 'src/storage.ts', status: 'modified', patch: '+  kmsKeyId: process.env.KMS_KEY_ID' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains token keyword', () => {
    const files = [{ filename: 'src/auth.ts', status: 'modified', patch: '+  const token = generateToken();' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  it('should spawn when patch contains gdpr keyword', () => {
    const files = [{ filename: 'src/privacy.ts', status: 'modified', patch: '+  // GDPR compliance' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('sensitive data keywords');
  });

  // ---- Non-matching files ---------------------------------------------------

  it('should not spawn for non-matching files without keywords', () => {
    const files = [{ filename: 'src/utils.ts', status: 'modified', patch: '+  return x + y;' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No data classification signals');
  });

  // ---- Empty / null / undefined files ---------------------------------------

  it('should not spawn for empty files array', () => {
    const result = shouldSpawnDataClassification([]);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  it('should not spawn for null files', () => {
    const result = shouldSpawnDataClassification(null);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  it('should not spawn for undefined files', () => {
    const result = shouldSpawnDataClassification(undefined);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  // ---- skip-review label ----------------------------------------------------

  it('should not spawn when skip-review label is present', () => {
    const files = [{ filename: 'infra/main.tf', status: 'modified' }];
    const result = shouldSpawnDataClassification(files, { labels: ['skip-review'] });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  it('should not spawn when skip-review label is among multiple labels', () => {
    const files = [{ filename: 'infra/main.tf', status: 'modified' }];
    const result = shouldSpawnDataClassification(files, { labels: ['enhancement', 'skip-review', 'urgent'] });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  // ---- Force flag -----------------------------------------------------------

  it('should spawn when force flag is set even with no matching files', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnDataClassification(files, { force: true });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('forced');
  });

  it('should spawn when force flag is set even with skip-review label', () => {
    const files = [{ filename: 'src/app.ts', status: 'modified' }];
    const result = shouldSpawnDataClassification(files, { labels: ['skip-review'], force: true });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('forced');
  });

  // ---- Docs-only and test-only exclusions -----------------------------------

  it('should not spawn for docs-only changes', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('documentation-only');
  });

  it('should not spawn for test-only changes', () => {
    const files = [{ filename: 'src/__tests__/auth.test.ts', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('test-only');
  });

  // ---- Combined reasons for multiple triggers --------------------------------

  it('should combine reasons for multiple pattern triggers', () => {
    const files = [
      { filename: 'infra/main.tf', status: 'modified' },
      { filename: '.env', status: 'modified' },
      { filename: 'src/api/users.ts', status: 'modified' },
    ];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Terraform/IaC');
    expect(result.reason).toContain('environment/secret');
    expect(result.reason).toContain('API route/handler');
  });

  it('should combine pattern and keyword triggers', () => {
    const files = [
      { filename: 'infra/main.tf', status: 'modified' },
      { filename: 'src/config.ts', status: 'modified', patch: '+  secret: "my-secret"' },
    ];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Terraform/IaC');
    expect(result.reason).toContain('sensitive data keywords');
  });

  // ---- Nested paths ---------------------------------------------------------

  it('should match Terraform files in subdirectories', () => {
    const files = [{ filename: 'services/api/infra/main.tf', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Terraform/IaC');
  });

  it('should match .env files in subdirectories', () => {
    const files = [{ filename: 'services/api/.env.production', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('environment/secret');
  });

  it('should match deploy manifests in k8s paths', () => {
    const files = [{ filename: 'deploy/kubernetes/service.yaml', status: 'modified' }];
    const result = shouldSpawnDataClassification(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Kubernetes/Helm');
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
