import { describe, expect, it } from 'vitest';

import {
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
});
