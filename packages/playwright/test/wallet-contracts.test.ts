import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createWalletContractRows, walletContractTests, writeWalletContractEvidence } from '../src/contracts.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

describe('wallet contract tests entrypoint', () => {
  it('exports a walletContractTests registration helper', () => {
    expect(walletContractTests).toBeTypeOf('function');
  });

  it('creates stable disconnected route smoke rows owned by app selectors', () => {
    const rows = createWalletContractRows({
      appName: 'Wildcat',
      baseUrl: 'http://127.0.0.1:3000',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      routes: [
        { name: 'lender', path: '/lender', walletAffordance: /connect|wallet/i },
        { name: 'borrower policy', path: '/borrower/policy', walletAffordance: 'Connect Wallet' }
      ]
    });

    expect(rows).toEqual([
      expect.objectContaining({
        title: 'Wildcat wallet contract: lender renders disconnected wallet affordance',
        scenario: 'disconnected',
        route: { name: 'lender', path: '/lender', walletAffordance: /connect|wallet/i },
        url: 'http://127.0.0.1:3000/lender',
        artifactBasename: 'contract-lender-disconnected'
      }),
      expect.objectContaining({
        title: 'Wildcat wallet contract: borrower-policy renders disconnected wallet affordance',
        scenario: 'disconnected',
        route: { name: 'borrower policy', path: '/borrower/policy', walletAffordance: 'Connect Wallet' },
        url: 'http://127.0.0.1:3000/borrower/policy',
        artifactBasename: 'contract-borrower-policy-disconnected'
      })
    ]);
  });

  it('writes screenshot-backed manifest and artifact-index evidence for a contract row', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'wallet-contracts-'));
    const screenshot = join(artifactDir, 'contract-lender-disconnected.png');
    await writeFile(screenshot, 'fake png bytes');
    const [row] = createWalletContractRows({
      appName: 'Wildcat',
      baseUrl: 'http://127.0.0.1:3000',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      routes: [{ name: 'lender', path: '/lender', walletAffordance: /connect|wallet/i }]
    });

    const evidence = await writeWalletContractEvidence({
      artifactDir,
      row,
      appName: 'Wildcat',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      screenshotPath: screenshot,
      status: 'passed',
      assertionSummary: 'wallet affordance visible'
    });

    const manifest = JSON.parse(await readFile(evidence.manifestPath, 'utf8'));
    const index = JSON.parse(await readFile(evidence.indexPath, 'utf8'));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      artifactType: 'wallet-contract-test',
      appName: 'Wildcat',
      route: { name: 'lender', path: '/lender' },
      scenario: 'disconnected',
      expectedChainId: 11155111,
      maskedExpectedAccount: '0x1111…1111',
      screenshot: { file: 'contract-lender-disconnected.png', sizeBytes: 14 },
      status: 'passed',
      assertionSummary: 'wallet affordance visible'
    });
    expect(manifest.screenshot.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain(ACCOUNT);
    expect(JSON.stringify(manifest)).not.toContain(artifactDir);
    expect(index).toMatchObject({
      artifactType: 'wallet-contract-artifact-index',
      summary: { manifestCount: 1, screenshotCount: 1 },
      manifests: [{ file: 'contract-lender-disconnected.json', screenshot: 'contract-lender-disconnected.png', status: 'passed' }]
    });
  });

  it('writes failed row evidence before rethrowing app-owned assertion failures', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'wallet-contracts-failed-'));
    const registered: Array<{ title: string; run: (fixtures: unknown, testInfo: unknown) => Promise<void> }> = [];
    const test = ((title: string, run: (fixtures: unknown, testInfo: unknown) => Promise<void>) => {
      registered.push({ title, run });
    }) as never;
    const page = {
      async goto() {},
      async screenshot({ path }: { path: string }) {
        await writeFile(path, 'failed png bytes');
      }
    };
    const testInfo = {
      outputDir: artifactDir,
      outputPath(file: string) {
        return join(artifactDir, file);
      }
    };

    walletContractTests({
      appName: 'Wildcat',
      baseUrl: 'http://127.0.0.1:3000',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      routes: [
        {
          name: 'lender',
          path: '/lender',
          assert: async () => {
            throw new Error('connect button missing');
          }
        }
      ],
      test
    });

    await expect(registered[0].run({ page }, testInfo)).rejects.toThrow('connect button missing');

    const manifest = JSON.parse(await readFile(join(artifactDir, 'contract-lender-disconnected.json'), 'utf8'));
    const index = JSON.parse(await readFile(join(artifactDir, 'wallet-contract-artifact-index.json'), 'utf8'));
    expect(manifest).toMatchObject({
      status: 'failed',
      assertionSummary: 'connect button missing',
      screenshot: { file: 'contract-lender-disconnected.png', sizeBytes: 16 }
    });
    expect(index.manifests).toEqual([
      expect.objectContaining({ file: 'contract-lender-disconnected.json', screenshot: 'contract-lender-disconnected.png', status: 'failed' })
    ]);
  });
});
