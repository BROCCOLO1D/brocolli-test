import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  createFailClosedWalletPromptDriver,
  createWalletArtifacts,
  createWalletQa,
  formatWalletQaFailure,
  redactWalletQaValue,
  annotateWalletQaArtifact,
  createWalletQaArtifactAnnotation,
  verifyWalletQaProofManifest,
  writeWalletQaArtifactIndex,
  writeWalletQaProofManifest,
  type WalletQaProofAttachment
} from '../src/index.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER_ACCOUNT = '0x2222222222222222222222222222222222222222';
const CHAIN_ID_HEX = '0xaa36a7';

async function tempArtifactDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wallet-qa-helper-'));
}

function createNetworkStub(account = ACCOUNT, chainId = 11155111) {
  return {
    async getChainId() { return chainId; },
    async getAccounts() { return [account]; },
    async switchChain() {},
    async addEthereumChain() {}
  };
}

describe('developer-first wallet QA fixture helpers', () => {
  it('supports wallet.connect({ click }) while preserving configured dapp state reads', async () => {
    const events: string[] = [];
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      origin: 'https://app.example',
      dapp: {
        async requestConnect() { events.push('configured-dapp-request'); },
        async getConnectedAccount() { events.push('dapp-account'); return ACCOUNT; }
      },
      prompt: {
        async approveConnection(input) { events.push(`prompt:${input.origin}`); }
      },
      network: createNetworkStub()
    });

    await expect(wallet.connect({
      click: async () => { events.push('click'); }
    })).resolves.toMatchObject({ status: 'connected', activeAccount: ACCOUNT, chainId: 11155111 });

    expect(events).toEqual(['click', 'prompt:https://app.example', 'dapp-account']);
  });

  it('keeps wallet.connect({ requestConnection }) backwards compatible', async () => {
    const events: string[] = [];
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      origin: 'https://app.example',
      dapp: { async requestConnect() {}, async getConnectedAccount() { return ACCOUNT; } },
      prompt: { async approveConnection() { events.push('prompt'); } },
      network: createNetworkStub()
    });

    await wallet.connect({ requestConnection: async () => { events.push('requestConnection'); } });
    expect(events).toEqual(['requestConnection', 'prompt']);
  });

  it('provides readable expectConnected and expectChain assertions', async () => {
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      network: createNetworkStub()
    });

    await expect(wallet.expectConnected()).resolves.toMatchObject({ status: 'verified', activeAccount: ACCOUNT, chainId: 11155111 });
    await expect(wallet.expectConnected({ expectedAccount: ACCOUNT, expectedChainId: 11155111 })).resolves.toMatchObject({ status: 'verified' });
    await expect(wallet.expectChain({ expectedChainId: 11155111 })).resolves.toMatchObject({ status: 'verified', chainId: 11155111 });
  });

  it('exposes a switchChain helper that requires explicit expected account and chain', async () => {
    const calls: string[] = [];
    let activeChain: string | number = 31337;
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      network: {
        async getChainId() { return activeChain; },
        async getAccounts() { return [ACCOUNT]; },
        async switchChain(chainIdHex: string) {
          calls.push(`switch:${chainIdHex}`);
          activeChain = chainIdHex;
        },
        async addEthereumChain() { calls.push('addEthereumChain'); }
      }
    });

    await expect(wallet.switchChain()).resolves.toMatchObject({ status: 'verified', activeAccount: ACCOUNT, chainId: 11155111 });
    expect(calls).toEqual(['switch:0xaa36a7']);
  });

  it('exposes personal-sign and typed-data helpers with explicit origin/account/chain safety inputs', async () => {
    const events: string[] = [];
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      origin: 'https://app.example',
      dapp: {
        async requestConnect() {},
        async getConnectedAccount() { return ACCOUNT; },
        async requestSignature(input) { events.push(`dapp:${input.signatureKind}:${input.message}`); }
      },
      prompt: {
        async approveSignature(input) { events.push(`prompt:${input.signatureKind}:${input.origin}:${input.expectedAccount}:${input.message}`); }
      },
      network: createNetworkStub()
    });

    await wallet.signMessage({ message: 'Sign in with Ethereum' });
    await wallet.signTypedData({ message: '{"domain":{"name":"Example"}}' });

    expect(events).toEqual([
      'dapp:personal_sign:Sign in with Ethereum',
      `prompt:personal_sign:https://app.example:${ACCOUNT}:Sign in with Ethereum`,
      'dapp:typed_data:{"domain":{"name":"Example"}}',
      `prompt:typed_data:https://app.example:${ACCOUNT}:{"domain":{"name":"Example"}}`
    ]);
  });

  it('fails closed before requesting a signature when origin or chain/account expectations are missing', async () => {
    const events: string[] = [];
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      dapp: {
        async requestConnect() {},
        async getConnectedAccount() { return ACCOUNT; },
        async requestSignature() { events.push('dapp'); }
      },
      prompt: {
        async approveSignature() { events.push('prompt'); }
      },
      network: createNetworkStub()
    });

    await expect(wallet.signMessage({ message: 'Sign in with Ethereum' })).rejects.toThrow(/origin/);
    expect(events).toEqual([]);
  });

  it('fails closed with actionable missing dapp action and expectation errors', async () => {
    const wallet = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      prompt: { async approveConnection() {} },
      network: createNetworkStub()
    });

    await expect(wallet.connect()).rejects.toThrow(/origin.*wallet\.connect|walletConfig\.origin/i);

    const withoutOrigin = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      prompt: { async approveConnection() {} },
      network: createNetworkStub()
    });
    await expect(withoutOrigin.connect({ click: async () => {} })).rejects.toThrow(/origin.*wallet\.connect|walletConfig\.origin/i);

    const withoutDappAction = createWalletQa(undefined as any, {
      expectedAccount: ACCOUNT,
      expectedChainId: 11155111,
      origin: 'https://app.example',
      prompt: { async approveConnection() {} },
      network: createNetworkStub()
    });
    await expect(withoutDappAction.connect()).rejects.toThrow(/click|requestConnection|walletConfig\.dapp|walletConfig\.dappSelectors/i);

    const chainOnly = createWalletQa(undefined as any, {
      expectedChainId: 11155111,
      network: createNetworkStub()
    });
    await expect(chainOnly.expectChain()).rejects.toThrow(/wallet\.expectChain.*expectedChainId/i);
    await expect(chainOnly.expectChain({ expectedChainId: 11155111 })).rejects.toThrow(/wallet\.expectChain.*expectedAccount.*walletConfig/i);
  });

  it('writes connectedProof manifests with masked accounts and no path leakage', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');
    const page = { screenshot: async ({ path }: { path: string }) => writeFile(path, 'fake png') };
    const artifacts = createWalletArtifacts(page as any, { artifactDir }, { project: { name: 'chromium' }, title: 'connects wallet' } as any);

    const manifestPath = await artifacts.connectedProof('dapp-connected', {
      origin: 'https://app.example',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot, contentType: 'image/png' }],
      notes: [`reviewed without exposing ${ACCOUNT} or /home/alice/private/profile`]
    });

    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      provenance: {
        packageName: '@broccolo1d/playwright',
        framework: 'playwright',
        tool: 'walletArtifacts.connectedProof'
      },
      test: { project: 'chromium', title: 'connects wallet' },
      summary: { status: 'connected', artifactCount: 1 },
      checksums: { artifactSha256: [expect.stringMatching(/^[0-9a-f]{64}$/)] }
    });
    expect(Date.parse(manifest.createdAt)).not.toBeNaN();
    expect(manifest.runId).toMatch(/^[a-f0-9-]{36}$/);
    expect(manifestText).toContain('0x1111…1111');
    expect(manifestText).toContain('dapp-connected.json');
    expect(manifestText).not.toContain(ACCOUNT);
    expect(manifestText).not.toContain(artifactDir);
    expect(manifestText).not.toContain('/home/alice');
    await expect(verifyWalletQaProofManifest(artifacts.artifactDir, 'dapp-connected.json')).resolves.toMatchObject({
      schemaVersion: 1,
      runId: manifest.runId,
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      provenance: { framework: 'playwright', tool: 'walletArtifacts.connectedProof' },
      manifest: { status: 'connected', maskedAccount: '0x1111…1111' }
    });

    const indexPath = await artifacts.writeArtifactIndex({ manifestNames: ['dapp-connected.json'], indexName: 'artifact-index.json' });
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    expect(index).toMatchObject({
      artifactType: 'wallet-qa-artifact-index',
      summary: { manifestCount: 1, connectedCount: 1, artifactCount: 1 },
      manifests: [{ file: 'dapp-connected.json', status: 'connected', maskedAccount: '0x1111…1111' }]
    });
  });
});

describe('fail-closed wallet prompt driver', () => {
  it('requires an expected origin before any prompt can be approved', () => {
    expect(() => createFailClosedWalletPromptDriver({
      expectedAccount: ACCOUNT,
      expectedChainIdHex: CHAIN_ID_HEX
    } as any)).toThrow(/origin.*required|fail closed/i);
  });

  it('rejects unexpected prompts when no delegate approval is configured', async () => {
    const prompt = createFailClosedWalletPromptDriver({
      origin: 'https://app.example',
      expectedAccount: ACCOUNT,
      expectedChainIdHex: CHAIN_ID_HEX
    });

    await expect(prompt.approveConnection?.({
      origin: 'https://app.example',
      expectedAccount: ACCOUNT,
      expectedChainIdHex: CHAIN_ID_HEX
    })).rejects.toThrow(/not configured.*fail closed/i);
    await expect(prompt.approveSignature?.({
      origin: 'https://app.example',
      expectedAccount: ACCOUNT,
      expectedChainIdHex: CHAIN_ID_HEX,
      signatureKind: 'personal_sign',
      message: 'Sign in to app.example'
    })).rejects.toThrow(/unexpected signature prompt/i);
    await expect(prompt.approveTransaction?.({ origin: 'https://app.example', expectedAccount: ACCOUNT })).rejects.toThrow(/unexpected transaction prompt/i);
  });

  it('rejects wrong origin, account, and chain before delegating', async () => {
    const approved: string[] = [];
    const prompt = createFailClosedWalletPromptDriver({
      origin: 'https://app.example',
      expectedAccount: ACCOUNT,
      expectedChainIdHex: CHAIN_ID_HEX,
      delegate: {
        async approveConnection() {
          approved.push('connection');
        }
      }
    });

    await expect(prompt.approveConnection?.({ origin: 'https://evil.example', expectedAccount: ACCOUNT, expectedChainIdHex: CHAIN_ID_HEX })).rejects.toThrow(/origin/i);
    await expect(prompt.approveConnection?.({ origin: 'https://app.example', expectedAccount: OTHER_ACCOUNT, expectedChainIdHex: CHAIN_ID_HEX })).rejects.toThrow(/account/i);
    await expect(prompt.approveConnection?.({ origin: 'https://app.example', expectedAccount: ACCOUNT, expectedChainIdHex: '0x1' })).rejects.toThrow(/chain/i);
    expect(approved).toEqual([]);

    await expect(prompt.approveConnection?.({ origin: 'https://app.example', expectedAccount: ACCOUNT, expectedChainIdHex: CHAIN_ID_HEX })).resolves.toBeUndefined();
    expect(approved).toEqual(['connection']);
  });
});

describe('wallet QA Playwright annotations', () => {
  it('creates stable public-safe annotations for proof manifests and artifact indexes', () => {
    expect(createWalletQaArtifactAnnotation({
      kind: 'proof-manifest',
      file: 'wallet-connected.json',
      status: 'connected',
      chainId: 11155111,
      maskedAccount: '0x1111…1111'
    })).toEqual({
      type: 'wallet-qa:proof-manifest',
      description: 'file=wallet-connected.json status=connected chainId=11155111 account=0x1111…1111'
    });

    expect(createWalletQaArtifactAnnotation({
      kind: 'artifact-index',
      file: 'wallet-qa-artifact-index.json',
      status: 'failed',
      note: `reviewed ${ACCOUNT} in /home/alice/private/profile`
    })).toEqual({
      type: 'wallet-qa:artifact-index',
      description: 'file=wallet-qa-artifact-index.json status=failed note=reviewed 0x1111…1111 in [path]/profile'
    });
  });

  it('pushes wallet QA annotations onto Playwright testInfo without exposing unsafe files', () => {
    const testInfo = { annotations: [] as Array<{ type: string; description?: string }> };

    annotateWalletQaArtifact(testInfo, {
      kind: 'proof-manifest',
      file: 'wallet-connected.json',
      status: 'connected',
      chainId: '0xaa36a7'
    });

    expect(testInfo.annotations).toEqual([
      {
        type: 'wallet-qa:proof-manifest',
        description: 'file=wallet-connected.json status=connected chainId=0xaa36a7'
      }
    ]);
    expect(() => annotateWalletQaArtifact(testInfo, { kind: 'proof-manifest', file: '../wallet-connected.json' })).toThrow(/safe basename/i);
  });
});

describe('wallet QA proof manifests', () => {
  it('writes a CI-friendly artifact index from verified proof manifests', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');
    const manifestPath = await writeWalletQaProofManifest({
      artifactDir,
      manifestName: 'wallet-connected.json',
      status: 'connected',
      origin: 'https://app.example',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot, contentType: 'image/png' }],
      runId: 'run-123',
      createdAt: '2026-01-01T00:00:00.000Z'
    });

    const indexPath = await writeWalletQaArtifactIndex({
      artifactDir,
      manifestNames: ['wallet-connected.json'],
      indexName: 'artifact-index.json',
      runId: 'index-run-123',
      createdAt: '2026-01-01T00:01:00.000Z'
    });

    const indexText = await readFile(indexPath, 'utf8');
    const index = JSON.parse(indexText);
    expect(indexPath).toBe(join(artifactDir, 'artifact-index.json'));
    expect(index).toMatchObject({
      schemaVersion: 1,
      artifactType: 'wallet-qa-artifact-index',
      createdAt: '2026-01-01T00:01:00.000Z',
      runId: 'index-run-123',
      summary: { manifestCount: 1, connectedCount: 1, failedCount: 0, artifactCount: 1 },
      manifests: [{
        file: 'wallet-connected.json',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        status: 'connected',
        origin: 'https://app.example',
        maskedAccount: '0x1111…1111',
        chainId: 11155111,
        artifactCount: 1,
        artifacts: [{ label: 'wallet-connected', file: 'connected.png', sizeBytes: 16, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]
      }]
    });
    expect(index.manifests[0].sha256).toBe((await verifyWalletQaProofManifest(artifactDir, 'wallet-connected.json')).manifestSha256);
    expect(indexText).not.toContain(artifactDir);
    expect(indexText).not.toContain(manifestPath);
    expect(indexText).not.toContain(ACCOUNT);
  });

  it('records redacted prompt and action decisions in proof manifests', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');

    const manifestPath = await writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      origin: 'https://app.example',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot }],
      decisions: [
        {
          kind: 'prompt',
          action: 'connect',
          decision: 'approved',
          promptKind: 'connect',
          origin: 'https://app.example',
          reason: `Prompt matched ${ACCOUNT} without profile /home/alice/wallet/profile`
        },
        {
          kind: 'action',
          action: 'artifact-review',
          decision: 'observed',
          reason: 'Screenshot reviewed before README promotion'
        }
      ]
    });

    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    expect(manifest.summary).toMatchObject({ status: 'connected', artifactCount: 1, decisionCount: 2 });
    expect(manifest.decisions).toEqual([
      {
        kind: 'prompt',
        action: 'connect',
        decision: 'approved',
        promptKind: 'connect',
        origin: 'https://app.example',
        reason: 'Prompt matched 0x1111…1111 without profile [path]/profile'
      },
      {
        kind: 'action',
        action: 'artifact-review',
        decision: 'observed',
        reason: 'Screenshot reviewed before README promotion'
      }
    ]);
    expect(manifestText).not.toContain(ACCOUNT);
    expect(manifestText).not.toContain('/home/alice');
    await expect(verifyWalletQaProofManifest(artifactDir)).resolves.toMatchObject({
      manifest: { summary: { decisionCount: 2 }, decisions: [{ promptKind: 'connect' }, { action: 'artifact-review' }] }
    });
  });

  it('writes and verifies public manifests with basename, sha256, and size only', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');

    const manifestPath = await writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      origin: 'https://app.example',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot, contentType: 'image/png' }]
    });

    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      runId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      provenance: {
        packageName: '@broccolo1d/playwright',
        framework: 'playwright',
        tool: 'writeWalletQaProofManifest'
      },
      summary: { status: 'connected', origin: 'https://app.example', maskedAccount: '0x1111…1111', chainId: 11155111, artifactCount: 1 },
      checksums: { artifactSha256: [expect.stringMatching(/^[0-9a-f]{64}$/)] }
    });
    expect(Date.parse(manifest.createdAt)).not.toBeNaN();
    expect(manifestText).not.toContain(artifactDir);
    expect(manifestText).not.toContain(ACCOUNT);
    expect(manifestText).toContain('0x1111…1111');
    expect(manifestText).toContain('connected.png');
    expect(manifestText).toMatch(/"sha256": "[0-9a-f]{64}"/);
    expect(manifestText).toMatch(/"sizeBytes": 16/);

    await expect(verifyWalletQaProofManifest(artifactDir)).resolves.toMatchObject({
      status: 'verified',
      schemaVersion: 1,
      createdAt: manifest.createdAt,
      runId: manifest.runId,
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      provenance: { packageName: '@broccolo1d/playwright', framework: 'playwright' },
      manifest: {
        status: 'connected',
        maskedAccount: '0x1111…1111',
        artifacts: [{ label: 'wallet-connected', file: 'connected.png', sizeBytes: 16 }]
      }
    });
  });

  it('rejects absolute artifact paths and full wallet addresses in public manifests', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');

    const absolutePathAttachment: WalletQaProofAttachment = { label: 'wallet-connected', path: screenshot };
    await expect(writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ ...absolutePathAttachment, publicFile: screenshot }]
    })).rejects.toThrow(/basename/i);

    await mkdir(join(artifactDir, 'nested'), { recursive: true });
    const manifestPath = join(artifactDir, 'wallet-qa-proof.json');
    await writeFile(manifestPath, JSON.stringify({
      artifactType: 'wallet-qa-proof',
      status: 'connected',
      maskedAccount: ACCOUNT,
      chainId: 11155111,
      artifacts: [{ label: 'wallet-connected', file: 'nested/connected.png', sizeBytes: 16, sha256: '0'.repeat(64) }]
    }));

    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/full wallet address|basename/i);

    await expect(writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      origin: 'https://app.example/connect?token=fake#state',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot }]
    })).rejects.toThrow(/origin/i);

    await expect(writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      origin: 'https://app.example/nested/path',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot }]
    })).rejects.toThrow(/origin/i);
  });

  it('rejects tampered provenance summaries and downgraded manifests without schemaVersion', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');
    const manifestPath = await writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      origin: 'https://app.example',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot }]
    });

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.summary.artifactCount = 2;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/summary/i);

    manifest.summary.artifactCount = 1;
    manifest.origin = 'https://app.example/callback';
    manifest.summary.origin = manifest.origin;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/origin/i);

    manifest.origin = 'https://app.example';
    manifest.summary.origin = manifest.origin;
    manifest.provenance.packageVersion = '9.9.9';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/package version provenance/i);

    manifest.provenance.packageVersion = '0.2.10';
    manifest.provenance.runtime = { node: 'v0.0.0', platform: process.platform, arch: process.arch };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/runtime provenance/i);

    manifest.provenance.runtime = { node: process.version, platform: process.platform, arch: process.arch };
    manifest.maskedAccount = 'not-a-masked-address';
    manifest.summary.maskedAccount = manifest.maskedAccount;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/masked account/i);

    manifest.maskedAccount = '0x1111…1111';
    manifest.summary.maskedAccount = manifest.maskedAccount;
    delete manifest.schemaVersion;
    delete manifest.createdAt;
    delete manifest.runId;
    delete manifest.provenance;
    delete manifest.test;
    delete manifest.summary;
    delete manifest.checksums;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/schemaVersion/i);
  });

  it('rejects schema v1 connected proofs without required evidence and artifacts', async () => {
    const artifactDir = await tempArtifactDir();
    await writeFile(join(artifactDir, 'wallet-qa-proof.json'), `${JSON.stringify({
      schemaVersion: 1,
      artifactType: 'wallet-qa-proof',
      createdAt: '2026-01-01T00:00:00.000Z',
      runId: 'empty-connected-proof',
      provenance: { packageName: '@broccolo1d/playwright', packageVersion: '0.2.10', framework: 'playwright', tool: 'test', runtime: { node: process.version, platform: process.platform, arch: process.arch } },
      status: 'connected',
      artifacts: [],
      summary: { status: 'connected', artifactCount: 0 },
      checksums: { artifactSha256: [] }
    }, null, 2)}\n`, 'utf8');

    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/connected proof.*evidence|origin|artifact/i);
  });

  it('rejects general local path leaks in public manifest failure details', async () => {
    const artifactDir = await tempArtifactDir();
    const screenshot = join(artifactDir, 'connected.png');
    await writeFile(screenshot, 'fake image bytes');

    await writeWalletQaProofManifest({
      artifactDir,
      status: 'connected',
      origin: 'https://app.example',
      account: ACCOUNT,
      chainId: 11155111,
      attachments: [{ label: 'wallet-connected', path: screenshot, contentType: 'image/png' }]
    });

    const manifestPath = join(artifactDir, 'wallet-qa-proof.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.failure = 'Profile leaked from /home/alice/secret/profile.json';
    manifest.details = {
      windowsProfile: 'C:\\Users\\alice\\secret',
      fileUrl: 'file:///tmp/foo',
      repoPath: '/home/mcsweeja/repos/brocolli-test/packages/playwright/src/index.ts'
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await expect(verifyWalletQaProofManifest(artifactDir)).rejects.toThrow(/local path leak/i);
  });

  it('formats failed assertions with redacted accounts and paths for docs', () => {
    const raw = new Error(`Account ${ACCOUNT} failed at /tmp/private/wallet/specs/connect.spec.ts against C:\\Users\\me\\secret\\profile`);
    const formatted = formatWalletQaFailure(raw);

    expect(formatted).toContain('0x1111…1111');
    expect(formatted).toContain('[path]/connect.spec.ts');
    expect(formatted).toContain('[path]/profile');
    expect(formatted).not.toContain(ACCOUNT);
    expect(formatted).not.toContain('/tmp/private');
    expect(redactWalletQaValue({ account: ACCOUNT, nested: [raw.message] })).not.toContain(ACCOUNT);
    const sensitive = redactWalletQaValue('private key 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa raw 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb npm_abcdefghijklmnopqrstuvwxyz123456');
    expect(sensitive).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(sensitive).not.toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(sensitive).not.toContain('npm_abcdefghijklmnopqrstuvwxyz123456');

    const labeled = redactWalletQaValue('seed phrase abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about wallet password hunter2 rpc https://user:secret@example.com/path');
    expect(labeled).toContain('[redacted:seed-phrase]');
    expect(labeled).not.toContain('abandon');
    expect(labeled).not.toContain('hunter2');
    expect(labeled).not.toContain('user:secret@example.com');

    const endpoint = redactWalletQaValue('endpoint https://sepolia.infura.io/v3/fake-rpc-token-redacted-value');
    expect(endpoint).toContain('[redacted:rpc-url]');
    expect(endpoint).not.toContain('fake-rpc-token-redacted-value');
  });
});
