import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveDefaultFixtureDappSmokeUrl } from '../src/metamask-smoke.js';

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
