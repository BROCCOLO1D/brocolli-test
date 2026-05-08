import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runWalletBrowserCli, verifyWildcatLenderArtifactManifest, WILDCAT_LENDER_MANIFEST } from '../src/index.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wildcat-lender-artifacts-'));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('Wildcat lender artifact manifest verifier', () => {
  it('verifies a connected Wildcat lender proof manifest with safe screenshot metadata', async () => {
    const artifactDir = await tempRoot();
    writeFileSync(join(artifactDir, 'wildcat-connected.png'), 'connected screenshot bytes');
    writeFileSync(
      join(artifactDir, WILDCAT_LENDER_MANIFEST),
      `${JSON.stringify(
        {
          artifactType: 'wildcat-lender-wallet-connection-proof',
          target: 'wildcat-lender',
          status: 'connected',
          evidence: {
            connectionState: 'connected',
            maskedAccount: '0x8161…4b61',
            chainId: 11155111,
            origin: 'https://testnet.wildcat.finance/lender'
          },
          screenshots: [
            {
              label: 'wildcat-connected',
              file: 'wildcat-connected.png',
              sizeBytes: 'connected screenshot bytes'.length,
              sha256: sha256('connected screenshot bytes')
            }
          ],
          diagnostics: ['MetaMask connect prompt approved through shared notification-page discovery.']
        },
        null,
        2
      )}\n`
    );

    const result = verifyWildcatLenderArtifactManifest(artifactDir);

    expect(result.status).toBe('verified-connected');
    expect(result.target).toBe('wildcat-lender');
    expect(result.evidence?.maskedAccount).toBe('0x8161…4b61');
    expect(result.screenshots).toHaveLength(1);
    expect(result.diagnostics.join(' ')).toContain('notification-page discovery');
  });

  it('verifies a failed Wildcat lender artifact manifest when it records a known blocker without screenshots', async () => {
    const artifactDir = await tempRoot();
    writeFileSync(
      join(artifactDir, WILDCAT_LENDER_MANIFEST),
      `${JSON.stringify(
        {
          artifactType: 'wildcat-lender-wallet-connection-proof',
          target: 'wildcat-lender',
          status: 'failed',
          failure: {
            blocker: 'metamask-notification-discovery',
            stage: 'approve-metamask-connect',
            safeMessage: 'No notification.html page appeared before timeout.'
          },
          diagnostics: ['Preserved redacted failure state only; no wallet screenshots were promoted.']
        },
        null,
        2
      )}\n`
    );

    const result = verifyWildcatLenderArtifactManifest(artifactDir);

    expect(result.status).toBe('verified-failed');
    expect(result.failure?.blocker).toBe('metamask-notification-discovery');
    expect(result.failure?.stage).toBe('approve-metamask-connect');
    expect(result.screenshots).toEqual([]);
  });

  it('rejects Wildcat manifests that leak full addresses or unsafe local paths', async () => {
    const artifactDir = await tempRoot();
    writeFileSync(
      join(artifactDir, WILDCAT_LENDER_MANIFEST),
      JSON.stringify({
        artifactType: 'wildcat-lender-wallet-connection-proof',
        target: 'wildcat-lender',
        status: 'failed',
        failure: {
          blocker: 'unknown',
          stage: 'open-target',
          safeMessage: `Full account 0x1111111111111111111111111111111111111111 at ${artifactDir}`
        }
      })
    );

    expect(() => verifyWildcatLenderArtifactManifest(artifactDir)).toThrow(/must not contain full wallet addresses|full artifact directory path/i);
  });

  it('rejects connected Wildcat proof captured on the wrong chain or origin', async () => {
    const artifactDir = await tempRoot();
    writeFileSync(join(artifactDir, 'wildcat-connected.png'), 'connected screenshot bytes');
    writeFileSync(
      join(artifactDir, WILDCAT_LENDER_MANIFEST),
      JSON.stringify({
        artifactType: 'wildcat-lender-wallet-connection-proof',
        target: 'wildcat-lender',
        status: 'connected',
        evidence: {
          connectionState: 'connected',
          maskedAccount: '0x8161…4b61',
          chainId: 1,
          origin: 'https://evil.example/lender'
        },
        screenshots: [
          {
            label: 'wildcat-connected',
            file: 'wildcat-connected.png',
            sizeBytes: 'connected screenshot bytes'.length,
            sha256: sha256('connected screenshot bytes')
          }
        ]
      })
    );

    expect(() => verifyWildcatLenderArtifactManifest(artifactDir)).toThrow(/Sepolia chain 11155111|Wildcat lender origin/i);
  });

  it('exposes Wildcat artifact verification through the CLI with redacted JSON output', async () => {
    const artifactDir = await tempRoot();
    writeFileSync(
      join(artifactDir, WILDCAT_LENDER_MANIFEST),
      JSON.stringify({
        artifactType: 'wildcat-lender-wallet-connection-proof',
        target: 'wildcat-lender',
        status: 'failed',
        failure: {
          blocker: 'wildcat-provider-state',
          stage: 'verify-wallet-state',
          safeMessage: 'Wildcat UI stayed disconnected after MetaMask approval.'
        }
      })
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['verify-wildcat-lender-artifacts', artifactDir],
      env: { METAMASK_PASSWORD: 'do-not-print-password' },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('');
    const result = JSON.parse(output) as { status: string; failure: { blocker: string } };
    expect(result.status).toBe('verified-failed');
    expect(result.failure.blocker).toBe('wildcat-provider-state');
    expect(output).not.toContain('do-not-print-password');
    expect(output).not.toContain(artifactDir);
  });
});
