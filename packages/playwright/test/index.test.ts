import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import packageJson from '../package.json';
import walletBrowserPackageJson from '../../wallet-browser/package.json';
import { defineWalletQaConfig, installDeterministicInjectedWallet, installWalletScenario, test, walletScenario } from '../src/index.js';
import type { DeterministicInjectedWalletPage, WalletScenarioState } from '../src/index.js';

type TestEthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, listener: unknown): void;
};

type WalletScenarioInitScript = (args: WalletScenarioState) => void;

async function recordWalletScenarioInstall(scenario: WalletScenarioState): Promise<{ initScript: WalletScenarioInitScript; initArgs: WalletScenarioState }> {
  let initScript: WalletScenarioInitScript | undefined;
  let initArgs: WalletScenarioState | undefined;
  const page = {
    async addInitScript(script: WalletScenarioInitScript, args: WalletScenarioState) {
      initScript = script;
      initArgs = args;
    }
  } as unknown as DeterministicInjectedWalletPage;

  await installWalletScenario(page, scenario);

  if (!initScript || !initArgs) throw new Error('Expected wallet scenario init script to be recorded.');
  return { initScript, initArgs };
}

function runInjectedWalletScript(initScript: WalletScenarioInitScript, initArgs: WalletScenarioState): { ethereum: TestEthereumProvider; restore: () => void } {
  const testGlobal = globalThis as typeof globalThis & { ethereum?: TestEthereumProvider };
  const previousEthereum = testGlobal.ethereum;
  initScript(initArgs);
  if (!testGlobal.ethereum) throw new Error('Expected wallet scenario to install ethereum provider.');

  return {
    ethereum: testGlobal.ethereum,
    restore: () => Object.defineProperty(globalThis, 'ethereum', { configurable: true, value: previousEthereum })
  };
}

describe('@broccolo1d/playwright exports', () => {
  it('declares a registry-safe wallet-browser dependency aligned with the published workspace release', () => {
    expect(packageJson.dependencies['@broccolo1d/wallet-browser']).toBe(`^${walletBrowserPackageJson.version}`);
  });

  it('keeps root README package versions aligned with package.json releases', async () => {
    const rootReadme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');

    expect(rootReadme).toContain(`@broccolo1d/wallet-browser\`](packages/wallet-browser/README.md) | \`${walletBrowserPackageJson.version}\``);
    expect(rootReadme).toContain(`@broccolo1d/playwright\`](packages/playwright/README.md) | \`${packageJson.version}\``);
  });

  it('keeps product roadmap install examples aligned with package.json releases', async () => {
    const productRoadmap = await readFile(new URL('../../../docs/product-roadmap.md', import.meta.url), 'utf8');

    expect(productRoadmap).toContain(`@broccolo1d/playwright@${packageJson.version}`);
  });

  it('documents and scripts registry release readiness checks for the current Playwright version', async () => {
    const rootPackageJson = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const rootReadme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
    const releaseScript = await readFile(new URL('../../../scripts/verify-playwright-release-readiness.mjs', import.meta.url), 'utf8');

    expect(rootPackageJson.scripts['verify:playwright-release']).toBe('node scripts/verify-playwright-release-readiness.mjs');
    expect(rootReadme).toContain('npm run verify:playwright-release');
    expect(rootReadme).toContain(`@broccolo1d/playwright@${packageJson.version}`);
    expect(releaseScript).toContain("npm', ['whoami'");
    expect(releaseScript).toContain("npm', ['view', `@broccolo1d/playwright@${playwrightVersion}`");
    expect(releaseScript).toContain('NPM_TOKEN');
    expect(releaseScript).toContain('NODE_AUTH_TOKEN');
    expect(releaseScript).toContain('--userconfig');
    expect(releaseScript).toContain('mkdtemp');
  });

  it('keeps the published dist provenance version aligned with package.json', async () => {
    const distIndex = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');

    expect(distIndex).toContain(`const PLAYWRIGHT_PACKAGE_VERSION = '${packageJson.version}';`);
  });

  it('exports an extended Playwright test and config helper', () => {
    expect(typeof test).toBe('function');
    expect(typeof test.extend).toBe('function');
    expect(defineWalletQaConfig({ use: { walletConfig: { useRealWallet: false } } })).toMatchObject({
      use: { walletConfig: { useRealWallet: false } }
    });
  });

  it('rejects zero or invalid deterministic injected wallet accounts', async () => {
    const page = { async addInitScript() {} } as unknown as DeterministicInjectedWalletPage;

    await expect(installDeterministicInjectedWallet(page, { account: '0x0000000000000000000000000000000000000000', chainId: 1 })).rejects.toThrow(
      /non-zero ethereum address/i
    );
    await expect(installDeterministicInjectedWallet(page, { account: 'not-an-address', chainId: 1 })).rejects.toThrow(
      /non-zero ethereum address/i
    );
  });

  it('builds connected wallet scenarios with normalized account and chain state', () => {
    const scenario = walletScenario()
      .connected({ account: '0xAa000000000000000000000000000000000000Bb' })
      .withChain(11155111)
      .withProviderInfo({ walletId: 'io.metamask', name: 'MetaMask' })
      .withTokenBalance({ symbol: 'USDC', amount: '1000' })
      .withPendingTransaction({ hash: '0xabc123', label: 'borrower-approval' })
      .build();

    expect(scenario).toMatchObject({
      account: '0xaa000000000000000000000000000000000000bb',
      chainIdHex: '0xaa36a7',
      connectionState: 'connected',
      providerInfo: { walletId: 'io.metamask', name: 'MetaMask' },
      tokenBalances: [{ symbol: 'USDC', amount: '1000' }],
      pendingTransactions: [{ hash: '0xabc123', label: 'borrower-approval' }]
    });
  });

  it('rejects invalid scenario accounts and chain ids', () => {
    expect(() => walletScenario().connected({ account: '0x0000000000000000000000000000000000000000' })).toThrow(/non-zero ethereum address/i);
    expect(() => walletScenario().connected({ account: 'not-an-address' })).toThrow(/non-zero ethereum address/i);
    expect(() => walletScenario().withChain(0)).toThrow(/positive integer/i);
    expect(() => walletScenario().withChain('not-a-chain')).toThrow(/positive integer/i);
  });

  it('installs disconnected wallet scenarios that return no eth_accounts', async () => {
    const { initScript, initArgs } = await recordWalletScenarioInstall(walletScenario().disconnected().withChain('0xaa36a7').build());

    expect(initArgs.connectionState).toBe('disconnected');

    const { ethereum, restore } = runInjectedWalletScript(initScript, initArgs);
    try {
      await expect(ethereum.request({ method: 'eth_accounts' })).resolves.toEqual([]);
      await expect(ethereum.request({ method: 'eth_chainId' })).resolves.toBe('0xaa36a7');
    } finally {
      restore();
    }
  });

  it('installs a deterministic injected wallet that answers account and chain requests', async () => {
    let initScript: ((args: WalletScenarioState) => void) | undefined;
    let initArgs: WalletScenarioState | undefined;
    const page = {
      async addInitScript(script: (args: WalletScenarioState) => void, args: WalletScenarioState) {
        initScript = script;
        initArgs = args;
      }
    } as unknown as DeterministicInjectedWalletPage;

    await installDeterministicInjectedWallet(page, {
      account: '0xAa000000000000000000000000000000000000Bb',
      chainId: 11155111
    });

    expect(initArgs).toMatchObject({
      account: '0xaa000000000000000000000000000000000000bb',
      chainIdHex: '0xaa36a7',
      connectionState: 'connected',
      providerInfo: { walletId: 'io.metamask', name: 'MetaMask' }
    });

    const listeners: Record<string, unknown> = {};
    const { ethereum, restore } = runInjectedWalletScript(initScript!, initArgs!);
    try {
      ethereum.on('accountsChanged', (accounts: string[]) => {
        listeners.accountsChanged = accounts;
      });

      await expect(ethereum.request({ method: 'eth_accounts' })).resolves.toEqual(['0xaa000000000000000000000000000000000000bb']);
      await expect(ethereum.request({ method: 'eth_chainId' })).resolves.toBe('0xaa36a7');
      expect(listeners.accountsChanged).toEqual(['0xaa000000000000000000000000000000000000bb']);
    } finally {
      restore();
    }
  });

  it('scripts deterministic wallet scenario method outcomes', async () => {
    const scenario = walletScenario()
      .connected({ account: '0xAa000000000000000000000000000000000000Bb' })
      .withChain(11155111)
      .rejectsMethod('personal_sign', { code: 4001, message: 'User rejected request.' })
      .resolvesMethod('eth_sendTransaction', '0x1234')
      .build();

    const { initScript, initArgs } = await recordWalletScenarioInstall(scenario);
    const { ethereum, restore } = runInjectedWalletScript(initScript, initArgs);
    try {
      await expect(ethereum.request({ method: 'personal_sign' })).rejects.toMatchObject({ code: 4001, message: 'User rejected request.' });
      await expect(ethereum.request({ method: 'eth_sendTransaction' })).resolves.toBe('0x1234');
    } finally {
      restore();
    }
  });

  it('announces wallet scenarios through optional EIP-6963 provider metadata', async () => {
    const scenario = walletScenario()
      .connected({ account: '0xAa000000000000000000000000000000000000Bb' })
      .withChain(11155111)
      .withProviderInfo({ walletId: 'io.metamask', name: 'MetaMask', rdns: 'io.metamask' })
      .build();

    const { initScript, initArgs } = await recordWalletScenarioInstall(scenario);
    const announcements: Array<{ detail: { info: { walletId?: string; name?: string; rdns?: string }; provider: unknown } }> = [];
    const testGlobal = globalThis as typeof globalThis & {
      addEventListener?: typeof globalThis.addEventListener;
      dispatchEvent?: typeof globalThis.dispatchEvent;
      CustomEvent?: typeof globalThis.CustomEvent;
    };
    const previousAddEventListener = testGlobal.addEventListener;
    const previousDispatchEvent = testGlobal.dispatchEvent;
    const previousCustomEvent = testGlobal.CustomEvent;
    const eventListeners = new Map<string, Array<(event: { detail?: unknown }) => void>>();
    testGlobal.addEventListener = ((event: string, listener: (event: { detail?: unknown }) => void) => {
      eventListeners.set(event, [...(eventListeners.get(event) ?? []), listener]);
    }) as typeof globalThis.addEventListener;
    testGlobal.dispatchEvent = ((event: { type: string; detail?: unknown }) => {
      if (event.type === 'eip6963:announceProvider') announcements.push(event as (typeof announcements)[number]);
      for (const listener of eventListeners.get(event.type) ?? []) listener(event);
      return true;
    }) as typeof globalThis.dispatchEvent;
    testGlobal.CustomEvent = class TestCustomEvent {
      type: string;
      detail?: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    } as typeof globalThis.CustomEvent;

    const { restore } = runInjectedWalletScript(initScript, initArgs);
    try {
      testGlobal.dispatchEvent?.(new CustomEvent('eip6963:requestProvider'));
      expect(announcements).toHaveLength(1);
      expect(announcements[0]?.detail.info).toMatchObject({ walletId: 'io.metamask', name: 'MetaMask', rdns: 'io.metamask' });
      expect(announcements[0]?.detail.provider).toBe(testGlobal.ethereum);
    } finally {
      restore();
      testGlobal.addEventListener = previousAddEventListener;
      testGlobal.dispatchEvent = previousDispatchEvent;
      testGlobal.CustomEvent = previousCustomEvent;
    }
  });
});
