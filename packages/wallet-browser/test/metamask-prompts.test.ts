import { describe, expect, it } from 'vitest';

import {
  classifyMetaMaskPromptText,
  createMetaMaskPromptDriver,
  type ExtensionBrowserContextLike,
  type ExtensionPageLike,
  type MetaMaskPromptPageLike
} from '../src/index.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';

class FakeLocator {
  constructor(
    private readonly selector: string,
    private readonly page: FakePromptPage
  ) {}

  async textContent(): Promise<string | null> {
    if (this.selector !== 'body') {
      return null;
    }
    return this.page.text;
  }

  async isVisible(): Promise<boolean> {
    return this.page.visibleSelectors.has(this.selector);
  }

  async click(): Promise<void> {
    if (!this.page.visibleSelectors.has(this.selector)) {
      throw new Error(`selector ${this.selector} is not visible`);
    }
    this.page.clicks.push(this.selector);
  }
}

class FakePromptPage implements MetaMaskPromptPageLike, ExtensionPageLike {
  public readonly clicks: string[] = [];
  public readonly visibleSelectors = new Set<string>();
  public broughtToFront = false;

  constructor(
    private readonly pageUrl: string,
    public text: string
  ) {}

  url(): string {
    return this.pageUrl;
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(selector, this);
  }

  async bringToFront(): Promise<void> {
    this.broughtToFront = true;
  }
}

function makeContext(page: FakePromptPage): ExtensionBrowserContextLike {
  return {
    pages() {
      return [
        { url: () => 'https://fixture.example/' },
        page
      ];
    }
  };
}

describe('MetaMask prompt driver', () => {
  it('discovers a notification page and approves only an origin-matching connection prompt', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#connect',
      'Connect with MetaMask https://fixture.example wants to connect to your account.'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-next"]');
    page.visibleSelectors.add('[data-testid="page-container-footer-connect"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await driver.approveConnection?.({
      origin: 'https://fixture.example/connect?session=sensitive-session',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7'
    });

    expect(page.broughtToFront).toBe(true);
    expect(page.clicks).toEqual([
      '[data-testid="page-container-footer-next"]',
      '[data-testid="page-container-footer-connect"]'
    ]);
  });

  it('fails closed without clicking when the notification prompt is for a different origin', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#connect',
      'Connect with MetaMask https://evil.example wants to connect to your account.'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-next"]');
    page.visibleSelectors.add('[data-testid="page-container-footer-connect"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveConnection?.({
      origin: 'https://fixture.example/connect?session=sensitive-session',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7'
    })).rejects.toThrow(/origin.*not found/i);

    expect(page.clicks).toEqual([]);
  });

  it('fails closed without clicking when the notification page looks like a transaction prompt', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#transaction',
      'Confirm transaction Send 0.01 ETH to another account from https://fixture.example'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-next"]');
    page.visibleSelectors.add('[data-testid="page-container-footer-connect"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveConnection?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7'
    })).rejects.toThrow(/unexpected metamask prompt/i);

    expect(page.clicks).toEqual([]);
  });

  it('reports the explicit non-connection marker before refusing a mixed fake connection prompt', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#connect',
      'Connect with MetaMask https://fixture.example wants to connect. Spending cap request: give permission to access your tokens.'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-next"]');
    page.visibleSelectors.add('[data-testid="page-container-footer-connect"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveConnection?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7'
    })).rejects.toThrow(/spending cap/);

    expect(page.clicks).toEqual([]);
  });

  it('fails closed when an expected approval button is not visible', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#connect',
      'Connect with MetaMask https://fixture.example wants to connect to your account.'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-next"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveConnection?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7'
    })).rejects.toThrow(/connect approval button/i);

    expect(page.clicks).toEqual(['[data-testid="page-container-footer-next"]']);
  });

  it('approves an origin-matching personal_sign prompt through the explicit signature path', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#personal-sign',
      'Signature request https://fixture.example wants you to sign this message: Sign in to Fixture'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-next"]');
    page.visibleSelectors.add('[data-testid="page-container-footer-confirm"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await driver.approveSignature?.({
      origin: 'https://fixture.example/sign?session=sensitive-session',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7',
      message: 'Sign in to Fixture',
      signatureKind: 'personal_sign'
    });

    expect(page.clicks).toEqual([
      '[data-testid="page-container-footer-next"]',
      '[data-testid="page-container-footer-confirm"]'
    ]);
  });

  it('approves an origin-matching typed-data signature prompt only when typed-data markers are present', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#typed-data',
      'Signature request https://fixture.example requests a typed data signature using eth_signTypedData_v4 Fixture Login'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-confirm"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await driver.approveSignature?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7',
      message: 'Fixture Login',
      signatureKind: 'typed_data'
    });

    expect(page.clicks).toEqual(['[data-testid="page-container-footer-confirm"]']);
  });

  it('fails closed without clicking when a signature approval sees a connection prompt', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#connect',
      'Connect with MetaMask https://fixture.example wants to connect to your account.'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-confirm"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveSignature?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7',
      message: 'Sign in to Fixture',
      signatureKind: 'personal_sign'
    })).rejects.toThrow(/while expecting a signature prompt/i);

    expect(page.clicks).toEqual([]);
  });

  it('fails closed without clicking when the expected signature message is absent', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#personal-sign',
      'Signature request https://fixture.example wants you to sign this message: Different message'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-confirm"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveSignature?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7',
      message: 'Sign in to Fixture',
      signatureKind: 'personal_sign'
    })).rejects.toThrow(/expected signature message/i);

    expect(page.clicks).toEqual([]);
  });

  it('keeps signature approval fail-closed when prompt text contains conflicting markers', async () => {
    const page = new FakePromptPage(
      'chrome-extension://metamaskid/notification.html#personal-sign',
      'Connect with MetaMask. Signature request https://fixture.example wants you to sign this message: Sign in to Fixture'
    );
    page.visibleSelectors.add('[data-testid="page-container-footer-confirm"]');

    const driver = createMetaMaskPromptDriver({ context: makeContext(page) });

    await expect(driver.approveSignature?.({
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      expectedChainIdHex: '0xaa36a7',
      message: 'Sign in to Fixture',
      signatureKind: 'personal_sign'
    })).rejects.toThrow(/Unexpected MetaMask prompt marker/i);

    expect(page.clicks).toEqual([]);
  });

  it('classifies ambiguous mixed-marker prompt text as unknown', () => {
    const classification = classifyMetaMaskPromptText(
      'Connect with MetaMask. Signature request https://fixture.example wants you to sign this message: Sign in'
    );

    expect(classification.kind).toBe('unknown');
    expect(classification.matchedMarker).toBeUndefined();
  });

  it('classifies simple prompt text by kind', () => {
    const cases = [
      {
        text: 'Connect with MetaMask https://fixture.example wants to connect to your account.',
        kind: 'connect'
      },
      {
        text: 'Allow this site to switch the network to Sepolia',
        kind: 'switch-chain'
      },
      {
        text: 'Allow this site to add a network named Sepolia',
        kind: 'add-chain'
      },
      {
        text: 'Signature request https://fixture.example wants you to sign this message: Sign in',
        kind: 'sign'
      },
      {
        text: 'Confirm transaction Send 0.01 ETH to another account from https://fixture.example',
        kind: 'transaction'
      },
      {
        text: 'Spending cap request: give permission to access your tokens',
        kind: 'token-approval'
      },
      {
        text: 'Welcome to your wallet dashboard',
        kind: 'unknown'
      }
    ] as const;

    for (const { text, kind } of cases) {
      expect(classifyMetaMaskPromptText(text).kind).toBe(kind);
    }
  });
});
