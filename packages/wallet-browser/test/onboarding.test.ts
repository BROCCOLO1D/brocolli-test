import { describe, expect, it } from 'vitest';

import {
  METAMASK_ONBOARDING_SELECTORS,
  createMetaMaskOnboardingPlan,
  createMetaMaskPageDriver,
  findMetaMaskExtensionPage,
  isMetaMaskExtensionPageUrl,
  maskSecret,
  resolveMetaMaskOnboardingConfig,
  validateEthereumAddress,
  validateMetaMaskPassword,
  validatePrivateKey,
  importPrivateKeyIntoMetaMaskPage,
  unlockMetaMaskPage,
  verifyMetaMaskActiveAddress,
  type MetaMaskOnboardingDriver
} from '../src/index.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const PRIVATE_KEY = `0x${'a'.repeat(64)}`;
const PASSWORD = 'correct horse battery staple';

describe('MetaMask onboarding config validation', () => {
  it('resolves onboarding inputs from explicit options without requiring env lookup', () => {
    const config = resolveMetaMaskOnboardingConfig({
      expectedAddress: ADDRESS,
      privateKey: PRIVATE_KEY,
      password: PASSWORD,
      timeoutMs: 42,
      debug: true
    });

    expect(config).toEqual({
      expectedAddress: ADDRESS.toLowerCase(),
      privateKey: PRIVATE_KEY,
      password: PASSWORD,
      timeoutMs: 42,
      debug: true
    });
  });

  it('resolves onboarding inputs from injected env rather than reading .env directly', () => {
    const config = resolveMetaMaskOnboardingConfig({
      env: {
        SEPOLIA_WALLET_ADDRESS: ADDRESS.toUpperCase(),
        SEPOLIA_WALLET_PRIVATE_KEY: PRIVATE_KEY.slice(2),
        METAMASK_PASSWORD: PASSWORD,
        METAMASK_ONBOARDING_TIMEOUT_MS: '90000',
        METAMASK_ONBOARDING_DEBUG: 'yes'
      }
    });

    expect(config.expectedAddress).toBe(ADDRESS);
    expect(config.privateKey).toBe(PRIVATE_KEY);
    expect(config.password).toBe(PASSWORD);
    expect(config.timeoutMs).toBe(90000);
    expect(config.debug).toBe(true);
  });

  it('validates address, private key, and password shapes', () => {
    expect(validateEthereumAddress(ADDRESS)).toBe(ADDRESS);
    expect(validatePrivateKey(PRIVATE_KEY.slice(2))).toBe(PRIVATE_KEY);
    expect(validateMetaMaskPassword(PASSWORD)).toBe(PASSWORD);

    expect(() => validateEthereumAddress('0x1234')).toThrow(/SEPOLIA_WALLET_ADDRESS/);
    expect(() => validatePrivateKey('0xnot-a-key')).toThrow(/SEPOLIA_WALLET_PRIVATE_KEY/);
    expect(() => validateMetaMaskPassword('short')).toThrow(/METAMASK_PASSWORD/);
  });
});

describe('MetaMask extension page discovery', () => {
  it('recognizes MetaMask extension page URLs and can require an extension id', () => {
    const url = 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html#onboarding/welcome';

    expect(isMetaMaskExtensionPageUrl(url)).toBe(true);
    expect(isMetaMaskExtensionPageUrl(url, 'nkbihfbeogaeaoehlefnkodbefgpgknn')).toBe(true);
    expect(isMetaMaskExtensionPageUrl(url, 'differentextensionid')).toBe(false);
    expect(isMetaMaskExtensionPageUrl('https://example.test')).toBe(false);
  });

  it('finds a single MetaMask extension page in a browser context and fails clearly otherwise', () => {
    const extensionPage = { url: () => 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html' };
    const dappPage = { url: () => 'https://fixture.test' };
    const context = { pages: () => [dappPage, extensionPage] };

    expect(findMetaMaskExtensionPage({ context: context as never, extensionId: 'nkbihfbeogaeaoehlefnkodbefgpgknn' })).toBe(extensionPage);
    expect(() => findMetaMaskExtensionPage({ context: { pages: () => [dappPage] } as never })).toThrow(/unknown MetaMask extension UI state/i);
    expect(() =>
      findMetaMaskExtensionPage({
        context: {
          pages: () => [
            extensionPage,
            { url: () => 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/notification.html' }
          ]
        } as never
      })
    ).toThrow(/multiple MetaMask extension pages/i);
  });
  it('fills the password and submits the unlock form through the page helper and driver', async () => {
    const calls: string[] = [];
    const page = {
      locator(selector: string) {
        return {
          async count() {
            return selector === METAMASK_ONBOARDING_SELECTORS.unlockPasswordInput ? 1 : 0;
          },
          async fill(value: string) {
            calls.push(`fill:${selector}:${value}`);
          },
          async click() {
            calls.push(`click:${selector}`);
          }
        };
      }
    } as never;

    await unlockMetaMaskPage(page, { expectedAddress: ADDRESS, password: PASSWORD, timeoutMs: 42 });
    expect(calls).toEqual([
      `fill:${METAMASK_ONBOARDING_SELECTORS.unlockPasswordInput}:${PASSWORD}`,
      `click:${METAMASK_ONBOARDING_SELECTORS.unlockSubmitButton}`
    ]);

    calls.length = 0;
    const driver = await createMetaMaskPageDriver({ context: { pages: () => [] } as never, page });
    await driver.unlock({ expectedAddress: ADDRESS, password: PASSWORD, timeoutMs: 42 });
    expect(calls).toEqual([
      `fill:${METAMASK_ONBOARDING_SELECTORS.unlockPasswordInput}:${PASSWORD}`,
      `click:${METAMASK_ONBOARDING_SELECTORS.unlockSubmitButton}`
    ]);
  });



  it('imports a MetaMask wallet through current onboarding selectors without exposing secrets', async () => {
    const calls: string[] = [];
    const visible = new Set<string>([
      METAMASK_ONBOARDING_SELECTORS.termsCheckbox,
      METAMASK_ONBOARDING_SELECTORS.importWalletButton,
      METAMASK_ONBOARDING_SELECTORS.noThanksMetricsButton,
      '[data-testid="import-srp__srp-word-0"]',
      '[data-testid="import-srp__srp-word-1"]',
      '[data-testid="import-srp__srp-word-2"]',
      '[data-testid="import-srp__srp-word-3"]',
      '[data-testid="import-srp__srp-word-4"]',
      '[data-testid="import-srp__srp-word-5"]',
      '[data-testid="import-srp__srp-word-6"]',
      '[data-testid="import-srp__srp-word-7"]',
      '[data-testid="import-srp__srp-word-8"]',
      '[data-testid="import-srp__srp-word-9"]',
      '[data-testid="import-srp__srp-word-10"]',
      '[data-testid="import-srp__srp-word-11"]',
      METAMASK_ONBOARDING_SELECTORS.passwordInput,
      METAMASK_ONBOARDING_SELECTORS.confirmPasswordInput,
      '[data-testid="import-srp-confirm"]',
      '[data-testid="onboarding-complete-done"]',
      '[data-testid="pin-extension-next"]',
      '[data-testid="pin-extension-done"]'
    ]);
    const page = {
      locator(selector: string) {
        return {
          first() { return this; },
          async count() { return visible.has(selector) ? 1 : 0; },
          async fill(value: string) { calls.push(`fill:${selector}:${value}`); },
          async click() { calls.push(`click:${selector}`); },
          async isVisible() { return visible.has(selector); },
          async innerText() { return 'Your wallet is ready'; }
        };
      },
      getByText() {
        return { first() { return this; }, async click() { calls.push('click:text'); } };
      },
      async waitForTimeout() {}
    } as never;

    await importPrivateKeyIntoMetaMaskPage(page, {
      expectedAddress: ADDRESS,
      privateKey: PRIVATE_KEY,
      password: PASSWORD,
      timeoutMs: 42
    });

    expect(calls).toContain(`click:${METAMASK_ONBOARDING_SELECTORS.termsCheckbox}`);
    expect(calls).toContain(`click:${METAMASK_ONBOARDING_SELECTORS.importWalletButton}`);
    expect(calls).toContain(`click:${METAMASK_ONBOARDING_SELECTORS.noThanksMetricsButton}`);
    expect(calls).toContain(`fill:${METAMASK_ONBOARDING_SELECTORS.passwordInput}:${PASSWORD}`);
    expect(calls).toContain(`fill:${METAMASK_ONBOARDING_SELECTORS.confirmPasswordInput}:${PASSWORD}`);
    expect(calls.join('\n')).not.toContain(PRIVATE_KEY);
  });

  it('verifies active MetaMask addresses from full or shortened page text', async () => {
    const page = {
      locator(selector: string) {
        return {
          async innerText() {
            return selector === 'body' ? `OWNER\n${ADDRESS.slice(0, 6)}...${ADDRESS.slice(-5)}\nEthereum Mainnet` : '';
          }
        };
      }
    } as never;

    await expect(verifyMetaMaskActiveAddress(page, ADDRESS)).resolves.toBe(ADDRESS);
  });

  it('creates a page-backed driver that can classify known MetaMask UI states', async () => {
    const makePage = (visibleSelector: string | undefined) =>
      ({
        locator(selector: string) {
          return {
            async count() {
              return selector === visibleSelector ? 1 : 0;
            }
          };
        }
      }) as never;

    await expect(
      (await createMetaMaskPageDriver({ context: { pages: () => [] } as never, page: makePage(METAMASK_ONBOARDING_SELECTORS.privateKeyInput) })).getState()
    ).resolves.toBe('needs-import');
    await expect(
      (await createMetaMaskPageDriver({ context: { pages: () => [] } as never, page: makePage(METAMASK_ONBOARDING_SELECTORS.unlockPasswordInput) })).getState()
    ).resolves.toBe('locked');
    await expect(
      (await createMetaMaskPageDriver({ context: { pages: () => [] } as never, page: makePage(METAMASK_ONBOARDING_SELECTORS.accountAddressButton) })).getState()
    ).resolves.toBe('unlocked');
    await expect(
      (await createMetaMaskPageDriver({ context: { pages: () => [] } as never, page: makePage(undefined) })).getState()
    ).resolves.toBe('unknown');
  });
});

describe('MetaMask onboarding redaction and mockable state machine', () => {
  it('creates public onboarding plans/status without raw secrets', () => {
    const config = resolveMetaMaskOnboardingConfig({ expectedAddress: ADDRESS, privateKey: PRIVATE_KEY, password: PASSWORD });
    const plan = createMetaMaskOnboardingPlan(config);
    const serialized = JSON.stringify(plan);

    expect(plan.status).toBe('pending');
    expect(plan.expectedAddress).toBe(ADDRESS);
    expect(plan.privateKey).not.toBe(PRIVATE_KEY);
    expect(plan.password).not.toBe(PASSWORD);
    expect(serialized).not.toContain(PRIVATE_KEY);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).toContain('redacted');
  });

  it('masks secrets deterministically for log-style output', () => {
    expect(maskSecret(PRIVATE_KEY)).toBe('0xaa…aaaa');
    expect(maskSecret(PASSWORD)).toBe('[redacted:28 chars]');
  });

  it('can exercise onboarding logic with a mock driver and verifies the active address', async () => {
    const calls: string[] = [];
    const driver: MetaMaskOnboardingDriver = {
      async getState() {
        calls.push('getState');
        return 'needs-import';
      },
      async importPrivateKey(input) {
        calls.push(`import:${input.expectedAddress}`);
      },
      async unlock(input) {
        calls.push(`unlock:${input.expectedAddress}`);
      },
      async getActiveAddress() {
        calls.push('getActiveAddress');
        return ADDRESS.toUpperCase();
      }
    };

    const config = resolveMetaMaskOnboardingConfig({ expectedAddress: ADDRESS, privateKey: PRIVATE_KEY, password: PASSWORD });
    const result = await createMetaMaskOnboardingPlan(config).run(driver);

    expect(result).toMatchObject({ status: 'verified', expectedAddress: ADDRESS, activeAddress: ADDRESS });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(calls).toEqual(['getState', `import:${ADDRESS}`, `unlock:${ADDRESS}`, 'getActiveAddress']);
  });

  it('fails closed on unknown MetaMask state or mismatched active address without leaking secrets', async () => {
    const config = resolveMetaMaskOnboardingConfig({ expectedAddress: ADDRESS, privateKey: PRIVATE_KEY, password: PASSWORD });

    await expect(
      createMetaMaskOnboardingPlan(config).run({
        async getState() {
          return 'unknown';
        },
        async importPrivateKey() {},
        async unlock() {},
        async getActiveAddress() {
          return ADDRESS;
        }
      })
    ).rejects.toThrow(/unknown MetaMask onboarding state/i);

    await expect(
      createMetaMaskOnboardingPlan(config).run({
        async getState() {
          return 'unlocked';
        },
        async importPrivateKey() {},
        async unlock() {},
        async getActiveAddress() {
          return '0x2222222222222222222222222222222222222222';
        }
      })
    ).rejects.toThrow(/does not match expected/);
  });

  it('redacts raw secrets from driver errors before exposing them to callers', async () => {
    const config = resolveMetaMaskOnboardingConfig({ expectedAddress: ADDRESS, privateKey: PRIVATE_KEY, password: PASSWORD });
    const driver: MetaMaskOnboardingDriver = {
      async getState() {
        return 'needs-import';
      },
      async importPrivateKey() {
        throw new Error(`MetaMask rejected private key ${PRIVATE_KEY} using password ${PASSWORD}`);
      },
      async unlock() {},
      async getActiveAddress() {
        return ADDRESS;
      }
    };

    try {
      await createMetaMaskOnboardingPlan(config).run(driver);
      throw new Error('Expected onboarding to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('private key');
      expect(message).not.toContain(PRIVATE_KEY);
      expect(message).not.toContain(PASSWORD);
      expect(message).toContain('[redacted');
    }
  });
});
