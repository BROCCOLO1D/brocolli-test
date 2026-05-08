import { describe, expect, it } from 'vitest';

import { discoverMetaMaskExtensionPage, waitForMetaMaskExtensionPage } from '../src/extension-pages.js';

interface FakePage {
  url(): string;
}

function page(url: string): FakePage {
  return { url: () => url };
}

describe('discoverMetaMaskExtensionPage', () => {
  it('selects a single MetaMask home page from extension pages', () => {
    const candidate = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html');

    expect(discoverMetaMaskExtensionPage([page('about:blank'), candidate])).toBe(candidate);
  });

  it('selects a single MetaMask onboarding page from extension pages', () => {
    const candidate = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html#onboarding/welcome');

    expect(discoverMetaMaskExtensionPage([candidate])).toBe(candidate);
  });

  it('selects a single MetaMask notification page from extension pages', () => {
    const candidate = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/notification.html');

    expect(discoverMetaMaskExtensionPage([candidate])).toBe(candidate);
  });

  it('can scope discovery to the expected extension id', () => {
    const expected = page('chrome-extension://expectedid/home.html');
    const unexpected = page('chrome-extension://otherid/home.html');

    expect(discoverMetaMaskExtensionPage([unexpected, expected], { extensionId: 'expectedid' })).toBe(expected);
  });

  it('fails closed when no MetaMask extension page is present', () => {
    expect(() => discoverMetaMaskExtensionPage([page('https://example.test/')])).toThrow('No MetaMask extension page found');
  });

  it('fails closed when multiple MetaMask extension page candidates are present', () => {
    expect(() =>
      discoverMetaMaskExtensionPage([
        page('chrome-extension://one/home.html'),
        page('chrome-extension://two/home.html#onboarding/welcome')
      ])
    ).toThrow('Multiple MetaMask extension page candidates found');
  });

  it('ignores stale or closed page handles while discovering the active MetaMask page', () => {
    const closed = { url: () => 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/notification.html', isClosed: () => true };
    const stale = { url: () => { throw new Error('Target closed'); } };
    const active = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html');

    expect(discoverMetaMaskExtensionPage([closed, stale, active])).toBe(active);
  });

  it('can prefer notification prompts when home and notification pages coexist after a dapp request', () => {
    const home = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html');
    const notification = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/notification.html');

    expect(discoverMetaMaskExtensionPage([home, notification], { preferredPath: '/notification.html' })).toBe(notification);
    expect(discoverMetaMaskExtensionPage([home, notification], { preferredPath: '/home.html' })).toBe(home);
  });

  it('waits for MetaMask pages by re-querying context pages instead of trusting stale snapshots', async () => {
    const notification = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/notification.html');
    const calls: string[] = [];
    const context = {
      pages: () => {
        calls.push('pages');
        return calls.length === 1 ? [page('about:blank')] : [page('about:blank'), notification];
      },
      async waitForEvent(eventName: string) {
        calls.push(`wait:${eventName}`);
        return notification;
      }
    };

    await expect(waitForMetaMaskExtensionPage(context, { preferredPath: '/notification.html', timeoutMs: 50 })).resolves.toBe(notification);
    expect(calls).toEqual(['pages', 'wait:page', 'pages']);
  });

  it('opens a keeper page before waiting when the context has no safe non-extension page', async () => {
    const home = page('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html');
    const calls: string[] = [];
    const keeper = page('about:blank');
    const context = {
      pages: () => {
        calls.push('pages');
        return calls.includes('newPage') ? [keeper, home] : [];
      },
      async newPage() {
        calls.push('newPage');
        return keeper;
      }
    };

    await expect(waitForMetaMaskExtensionPage(context, { ensureKeeperPage: true, timeoutMs: 50 })).resolves.toBe(home);
    expect(calls).toEqual(['pages', 'newPage', 'pages']);
  });

});
