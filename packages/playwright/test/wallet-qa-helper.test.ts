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
  verifyWalletQaProofManifest,
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
    expect(manifestText).toContain('0x1111…1111');
    expect(manifestText).toContain('dapp-connected.json');
    expect(manifestText).not.toContain(ACCOUNT);
    expect(manifestText).not.toContain(artifactDir);
    expect(manifestText).not.toContain('/home/alice');
    await expect(verifyWalletQaProofManifest(artifacts.artifactDir, 'dapp-connected.json')).resolves.toMatchObject({
      manifest: { status: 'connected', maskedAccount: '0x1111…1111' }
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
    await expect(prompt.approveSignature?.({ origin: 'https://app.example', expectedAccount: ACCOUNT })).rejects.toThrow(/unexpected signature prompt/i);
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

describe('wallet QA proof manifests', () => {
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
    expect(manifestText).not.toContain(artifactDir);
    expect(manifestText).not.toContain(ACCOUNT);
    expect(manifestText).toContain('0x1111…1111');
    expect(manifestText).toContain('connected.png');
    expect(manifestText).toMatch(/"sha256": "[0-9a-f]{64}"/);
    expect(manifestText).toMatch(/"sizeBytes": 16/);

    await expect(verifyWalletQaProofManifest(artifactDir)).resolves.toMatchObject({
      status: 'verified',
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
  });
});
