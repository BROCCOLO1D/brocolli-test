import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runWalletBrowserCli, verifyFixtureConnectionProofManifest } from '../src/index.js';

async function tempArtifactDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'abw-fixture-proof-'));
  const artifactDir = join(root, '.wallet-artifacts', 'fixture-connection-proof', 'run');
  mkdirSync(artifactDir, { recursive: true });
  return artifactDir;
}

function writeProofManifest(
  artifactDir: string,
  overrides: Record<string, unknown> = {},
  screenshotBytes = 'connected fixture screenshot bytes'
): void {
  writeFileSync(join(artifactDir, 'fixture-connected.png'), screenshotBytes);
  const manifest = {
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    runId: 'fixture-proof-test-run',
    provenance: {
      packageName: '@broccolo1d/wallet-browser',
      packageVersion: '0.2.6',
      framework: 'wallet-browser',
      tool: 'verifyFixtureConnectionProofManifest',
      runtime: { node: process.version, platform: process.platform, arch: process.arch }
    },
    artifactType: 'fixture-dapp-wallet-connection-proof',
    target: 'fixture-dapp',
    status: 'connected',
    evidence: {
      connectionState: 'connected',
      maskedAccount: '0x8161…4b61',
      chainId: 11155111,
      origin: 'http://127.0.0.1:5173'
    },
    screenshots: [
      {
        label: 'fixture-connected',
        file: 'fixture-connected.png',
        sizeBytes: screenshotBytes.length,
        sha256: createHash('sha256').update(screenshotBytes).digest('hex')
      }
    ],
    notes: ['Captured only after the fixture reported a connected masked account on Sepolia.'],
    ...overrides
  };
  writeFileSync(join(artifactDir, 'FIXTURE-PROOF-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('fixture connection proof manifest verification', () => {
  it('verifies a connected fixture proof manifest without exposing full local paths', async () => {
    const artifactDir = await tempArtifactDir();
    writeProofManifest(artifactDir);

    const result = verifyFixtureConnectionProofManifest(artifactDir);

    expect(result).toMatchObject({
      status: 'verified',
      artifactDir,
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      runId: 'fixture-proof-test-run',
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      provenance: {
        packageName: '@broccolo1d/wallet-browser',
        packageVersion: '0.2.6',
        framework: 'wallet-browser',
        tool: 'verifyFixtureConnectionProofManifest',
        runtime: { node: process.version, platform: process.platform, arch: process.arch }
      },
      evidence: {
        connectionState: 'connected',
        maskedAccount: '0x8161…4b61',
        chainId: 11155111,
        origin: 'http://127.0.0.1:5173'
      }
    });
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].file).toBe('fixture-connected.png');
  });

  it('rejects tampered package and runtime provenance', async () => {
    const packageVersionDir = await tempArtifactDir();
    writeProofManifest(packageVersionDir, {
      provenance: {
        packageName: '@broccolo1d/wallet-browser',
        packageVersion: '9.9.9',
        framework: 'wallet-browser',
        tool: 'verifyFixtureConnectionProofManifest',
        runtime: { node: process.version, platform: process.platform, arch: process.arch }
      }
    });
    expect(() => verifyFixtureConnectionProofManifest(packageVersionDir)).toThrow(/package version provenance/i);

    const runtimeDir = await tempArtifactDir();
    writeProofManifest(runtimeDir, {
      provenance: {
        packageName: '@broccolo1d/wallet-browser',
        packageVersion: '0.2.6',
        framework: 'wallet-browser',
        tool: 'verifyFixtureConnectionProofManifest',
        runtime: { node: 'v0.0.0', platform: process.platform, arch: process.arch }
      }
    });
    expect(() => verifyFixtureConnectionProofManifest(runtimeDir)).toThrow(/runtime provenance/i);
  });

  it('rejects downgraded manifests without schemaVersion provenance', async () => {
    const artifactDir = await tempArtifactDir();
    writeProofManifest(artifactDir, {
      schemaVersion: undefined,
      createdAt: undefined,
      runId: undefined,
      provenance: undefined
    });

    expect(() => verifyFixtureConnectionProofManifest(artifactDir)).toThrow(/schemaVersion/i);
  });

  it('fails if the proof is still loading, onboarding, or disconnected instead of connected', async () => {
    for (const connectionState of ['loading', 'onboarding', 'disconnected']) {
      const artifactDir = await tempArtifactDir();
      writeProofManifest(artifactDir, {
        evidence: {
          connectionState,
          maskedAccount: '0x8161…4b61',
          chainId: 11155111,
          origin: 'http://127.0.0.1:5173'
        }
      });

      expect(() => verifyFixtureConnectionProofManifest(artifactDir)).toThrow(/must show connected fixture state/i);
    }
  });

  it('fails closed on full wallet addresses or the wrong Sepolia chain before accepting proof', async () => {
    const fullAddressDir = await tempArtifactDir();
    const unsafeFullAddress = `0x${'1'.repeat(40)}`;
    writeProofManifest(fullAddressDir, {
      evidence: {
        connectionState: 'connected',
        maskedAccount: unsafeFullAddress,
        chainId: 11155111,
        origin: 'http://127.0.0.1:5173'
      }
    });
    expect(() => verifyFixtureConnectionProofManifest(fullAddressDir)).toThrow(/masked account/i);

    const wrongChainDir = await tempArtifactDir();
    writeProofManifest(wrongChainDir, {
      evidence: {
        connectionState: 'connected',
        maskedAccount: '0x8161…4b61',
        chainId: 1,
        origin: 'http://127.0.0.1:5173'
      }
    });
    expect(() => verifyFixtureConnectionProofManifest(wrongChainDir)).toThrow(/Sepolia chain/i);
  });

  it('fails if the manifest contains absolute artifact paths, RPC token URLs, or a tampered screenshot hash', async () => {
    const pathLeakDir = await tempArtifactDir();
    writeProofManifest(pathLeakDir, { notes: [`unsafe path ${pathLeakDir}`] });
    expect(() => verifyFixtureConnectionProofManifest(pathLeakDir)).toThrow(/full artifact directory path/i);

    const rpcLeakDir = await tempArtifactDir();
    writeProofManifest(rpcLeakDir, { notes: ['endpoint https://sepolia.infura.io/v3/fake-rpc-token-redacted-value'] });
    expect(() => verifyFixtureConnectionProofManifest(rpcLeakDir)).toThrow(/raw secrets or tokens/i);

    const tamperedDir = await tempArtifactDir();
    writeProofManifest(tamperedDir, {
      screenshots: [
        {
          label: 'fixture-connected',
          file: 'fixture-connected.png',
          sizeBytes: 'connected fixture screenshot bytes'.length,
          sha256: createHash('sha256').update('different bytes').digest('hex')
        }
      ]
    });
    expect(() => verifyFixtureConnectionProofManifest(tamperedDir)).toThrow(/hash mismatch/i);
  });

  it('exposes a CI-safe CLI verifier for fixture connection proof artifacts', async () => {
    const artifactDir = await tempArtifactDir();
    writeProofManifest(artifactDir);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['verify-fixture-proof', artifactDir],
      env: { METAMASK_PASSWORD: 'do-not-print-this-password' },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('');
    const result = JSON.parse(output) as {
      status: string;
      artifactDir: string;
      manifestPath: string;
      evidence: { connectionState: string; maskedAccount: string };
    };
    expect(result.status).toBe('verified');
    expect(result.artifactDir).toBe('[redacted:artifact-dir]');
    expect(result.manifestPath).toBe('[redacted:manifest-path]');
    expect(result.evidence).toMatchObject({ connectionState: 'connected', maskedAccount: '0x8161…4b61' });
    expect(output).not.toContain('do-not-print-this-password');
    expect(output).not.toContain(artifactDir);
  });

  it('rejects fixture proof local path leaks and redacts missing-manifest CLI errors', async () => {
    const leakDir = await tempArtifactDir();
    writeProofManifest(leakDir, { notes: ['unsafe /home/alice/secret/profile.json and C:\\Users\\alice\\secret'] });
    expect(() => verifyFixtureConnectionProofManifest(leakDir)).toThrow(/local path leaks/i);

    const missingDir = await tempArtifactDir();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runWalletBrowserCli({
      argv: ['verify-fixture-proof', missingDir],
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).not.toContain(missingDir);
    expect(stderr.join('')).toMatch(/fixture proof verification failed/i);
  });
});
