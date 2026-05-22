import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createWalletContractRows, verifyWalletContractManifest, walletContractTests, writeWalletContractEvidence } from '../src/contracts.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

describe('wallet contract tests entrypoint', () => {
  it('exports a walletContractTests registration helper', () => {
    expect(walletContractTests).toBeTypeOf('function');
  });

  it('creates stable wallet state rows owned by app selectors', () => {
    const rows = createWalletContractRows({
      appName: 'Wildcat',
      baseUrl: 'http://127.0.0.1:3000',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      routes: [
        { name: 'lender', path: '/lender', walletAffordance: /connect|wallet/i },
        { name: 'borrower policy', path: '/borrower/policy', walletAffordance: 'Connect Wallet' }
      ],
      assertConnected: async () => {},
      assertWrongChain: async () => {},
      assertInvalidAccount: async () => {}
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
        title: 'Wildcat wallet contract: lender shows connected wallet state',
        scenario: 'connected',
        artifactBasename: 'contract-lender-connected'
      }),
      expect.objectContaining({
        title: 'Wildcat wallet contract: lender fails closed on wrong chain',
        scenario: 'wrong-chain',
        artifactBasename: 'contract-lender-wrong-chain'
      }),
      expect.objectContaining({
        title: 'Wildcat wallet contract: lender fails closed on invalid account',
        scenario: 'invalid-account',
        artifactBasename: 'contract-lender-invalid-account'
      }),
      expect.objectContaining({
        title: 'Wildcat wallet contract: borrower-policy renders disconnected wallet affordance',
        scenario: 'disconnected',
        route: { name: 'borrower policy', path: '/borrower/policy', walletAffordance: 'Connect Wallet' },
        url: 'http://127.0.0.1:3000/borrower/policy',
        artifactBasename: 'contract-borrower-policy-disconnected'
      }),
      expect.objectContaining({ scenario: 'connected', artifactBasename: 'contract-borrower-policy-connected' }),
      expect.objectContaining({ scenario: 'wrong-chain', artifactBasename: 'contract-borrower-policy-wrong-chain' }),
      expect.objectContaining({ scenario: 'invalid-account', artifactBasename: 'contract-borrower-policy-invalid-account' })
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

    const verified = await verifyWalletContractManifest(artifactDir, 'contract-lender-disconnected.json');
    expect(verified).toMatchObject({
      appName: 'Wildcat',
      route: { name: 'lender', path: '/lender' },
      scenario: 'disconnected',
      screenshot: { file: 'contract-lender-disconnected.png', sizeBytes: 14 },
      status: 'passed'
    });
  });

  it('rejects contract manifests when screenshot evidence is missing or mutated', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'wallet-contracts-mutated-'));
    const screenshot = join(artifactDir, 'contract-lender-disconnected.png');
    await writeFile(screenshot, 'original png bytes');
    const [row] = createWalletContractRows({
      appName: 'Wildcat',
      baseUrl: 'http://127.0.0.1:3000',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      routes: [{ name: 'lender', path: '/lender' }]
    });
    await writeWalletContractEvidence({
      artifactDir,
      row,
      appName: 'Wildcat',
      expectedChainId: 11155111,
      expectedAccount: ACCOUNT,
      screenshotPath: screenshot,
      status: 'passed'
    });

    await writeFile(screenshot, 'mutated png bytes!');

    await expect(verifyWalletContractManifest(artifactDir, 'contract-lender-disconnected.json')).rejects.toThrow(
      'Wallet contract manifest screenshot sha256 mismatch.'
    );
  });

  it('writes failed row evidence before rethrowing app-owned assertion failures', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'wallet-contracts-failed-'));
    const registered: Array<{ title: string; run: (fixtures: unknown, testInfo: unknown) => Promise<void> }> = [];
    const test = ((title: string, run: (fixtures: unknown, testInfo: unknown) => Promise<void>) => {
      registered.push({ title, run });
    }) as never;
    const page = {
      async addInitScript() {},
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
