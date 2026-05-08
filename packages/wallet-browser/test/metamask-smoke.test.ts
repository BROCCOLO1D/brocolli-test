import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveDefaultFixtureDappSmokeUrl, verifySmokeArtifactManifest, writeSmokeArtifactManifest, writeSmokeInspectionGuide } from '../src/metamask-smoke.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wallet-browser-smoke-'));
}

describe('resolveDefaultFixtureDappSmokeUrl', () => {
  it('returns the repo fixture dapp file URL when index.html exists', async () => {
    const cwd = await tempRoot();
    const fixtureDir = join(cwd, 'apps', 'fixture-dapp');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'index.html'), '<!doctype html><title>Fixture dapp</title>\n');

    expect(resolveDefaultFixtureDappSmokeUrl(cwd)).toBe(pathToFileURL(join(fixtureDir, 'index.html')).toString());
  });

  it('returns undefined when the fixture dapp is not present', async () => {
    expect(resolveDefaultFixtureDappSmokeUrl(await tempRoot())).toBeUndefined();
  });
});

describe('writeSmokeInspectionGuide', () => {
  it('writes a local checklist for reviewing generated smoke screenshots before publication', async () => {
    const artifactDir = await tempRoot();
    const guidePath = writeSmokeInspectionGuide({
      artifactDir,
      screenshots: [
        { label: 'browser-page', path: join(artifactDir, 'browser-page.png') },
        { label: 'metamask-extension', path: join(artifactDir, 'metamask-extension.png') }
      ],
      notes: ['No wallet was imported, unlocked, connected, used to sign, or used to transact.']
    });

    const guide = readFileSync(guidePath, 'utf8');
    expect(guidePath).toBe(join(artifactDir, 'INSPECTION.md'));
    expect(guide).toContain('# Wallet browser smoke screenshot inspection');
    expect(guide).toContain('- [ ] Confirm `browser-page.png` contains no seed phrases, private keys, passwords, RPC tokens, full wallet addresses, or sensitive local paths.');
    expect(guide).toContain('- [ ] Confirm `metamask-extension.png` contains no seed phrases, private keys, passwords, RPC tokens, full wallet addresses, or sensitive local paths.');
    expect(guide).toContain('- No wallet was imported, unlocked, connected, used to sign, or used to transact.');
    expect(guide).toContain('Keep this artifact directory ignored/local-only unless every screenshot above is reviewed and intentionally promoted.');
  });
});

describe('writeSmokeArtifactManifest', () => {
  it('writes a local provenance manifest with screenshot hashes and basenames only', async () => {
    const artifactDir = await tempRoot();
    const browserScreenshotPath = join(artifactDir, 'browser-page.png');
    const extensionScreenshotPath = join(artifactDir, 'metamask-extension.png');
    const inspectionGuidePath = join(artifactDir, 'INSPECTION.md');
    writeFileSync(browserScreenshotPath, 'browser image bytes');
    writeFileSync(extensionScreenshotPath, 'extension image bytes');
    writeFileSync(inspectionGuidePath, '# Review checklist\n');

    const manifestPath = writeSmokeArtifactManifest({
      artifactDir,
      screenshots: [
        { label: 'browser-page', path: browserScreenshotPath },
        { label: 'metamask-extension', path: extensionScreenshotPath }
      ],
      inspectionGuidePath,
      notes: ['Treat generated screenshots as local-only until visually inspected for sensitive content.']
    });

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      artifactType: string;
      inspectionGuide: string;
      screenshots: Array<{ label: string; file: string; sizeBytes: number; sha256: string }>;
      notes: string[];
    };

    expect(manifestPath).toBe(join(artifactDir, 'SMOKE-MANIFEST.json'));
    expect(manifest.artifactType).toBe('wallet-browser-smoke-screenshots');
    expect(manifest.inspectionGuide).toBe('INSPECTION.md');
    expect(JSON.stringify(manifest)).not.toContain(artifactDir);
    expect(manifest.screenshots).toEqual([
      {
        label: 'browser-page',
        file: 'browser-page.png',
        sizeBytes: 'browser image bytes'.length,
        sha256: createHash('sha256').update('browser image bytes').digest('hex')
      },
      {
        label: 'metamask-extension',
        file: 'metamask-extension.png',
        sizeBytes: 'extension image bytes'.length,
        sha256: createHash('sha256').update('extension image bytes').digest('hex')
      }
    ]);
    expect(manifest.notes).toEqual(['Treat generated screenshots as local-only until visually inspected for sensitive content.']);
  });
});

describe('verifySmokeArtifactManifest', () => {
  it('verifies screenshot hashes and rejects path-bearing manifest metadata', async () => {
    const artifactDir = await tempRoot();
    const browserScreenshotPath = join(artifactDir, 'browser-page.png');
    const extensionScreenshotPath = join(artifactDir, 'metamask-extension.png');
    const inspectionGuidePath = join(artifactDir, 'INSPECTION.md');
    writeFileSync(browserScreenshotPath, 'browser image bytes');
    writeFileSync(extensionScreenshotPath, 'extension image bytes');
    writeFileSync(inspectionGuidePath, '# Review checklist\n');
    writeSmokeArtifactManifest({
      artifactDir,
      screenshots: [
        { label: 'browser-page', path: browserScreenshotPath },
        { label: 'metamask-extension', path: extensionScreenshotPath }
      ],
      inspectionGuidePath,
      notes: ['No wallet was imported, unlocked, connected, used to sign, or used to transact.']
    });

    const result = verifySmokeArtifactManifest(artifactDir);

    expect(result.status).toBe('verified');
    expect(result.artifactDir).toBe(artifactDir);
    expect(result.manifestPath).toBe(join(artifactDir, 'SMOKE-MANIFEST.json'));
    expect(result.inspectionGuidePath).toBe(inspectionGuidePath);
    expect(result.screenshots.map((screenshot) => screenshot.file)).toEqual(['browser-page.png', 'metamask-extension.png']);
  });

  it('fails closed when a screenshot hash no longer matches the manifest', async () => {
    const artifactDir = await tempRoot();
    const screenshotPath = join(artifactDir, 'browser-page.png');
    const inspectionGuidePath = join(artifactDir, 'INSPECTION.md');
    writeFileSync(screenshotPath, 'original bytes');
    writeFileSync(inspectionGuidePath, '# Review checklist\n');
    writeSmokeArtifactManifest({
      artifactDir,
      screenshots: [{ label: 'browser-page', path: screenshotPath }],
      inspectionGuidePath,
      notes: []
    });
    writeFileSync(screenshotPath, 'tampered bytes');

    expect(() => verifySmokeArtifactManifest(artifactDir)).toThrow(/hash mismatch/i);
  });
});
