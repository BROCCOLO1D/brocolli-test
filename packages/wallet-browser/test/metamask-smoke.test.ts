import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveDefaultFixtureDappSmokeUrl, writeSmokeInspectionGuide } from '../src/metamask-smoke.js';

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
