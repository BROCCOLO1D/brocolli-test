import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PINNED_METAMASK_VERSION,
  buildChromiumExtensionArgs,
  prepareChromiumLaunchOptions,
  resolveWalletBrowserConfig
} from '../src/index.js';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wallet-browser-config-'));
}

describe('resolveWalletBrowserConfig', () => {
  it('falls back to the pinned MetaMask artifact path when no override is configured', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, '.wallet-extensions', 'metamask', PINNED_METAMASK_VERSION, 'chrome');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask', version: PINNED_METAMASK_VERSION }));

    const config = resolveWalletBrowserConfig({ cwd, env: {} });

    expect(config.metamaskExtensionPath).toBe(extensionPath);
    expect(config.metamaskExtensionVersion).toBe(PINNED_METAMASK_VERSION);
  });

  it('rejects the default pinned MetaMask artifact when manifest version does not match the configured version', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, '.wallet-extensions', 'metamask', PINNED_METAMASK_VERSION, 'chrome');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask', version: '13.28.0' }));

    expect(() => resolveWalletBrowserConfig({ cwd, env: {} })).toThrow(/MetaMask extension manifest version must match configured version/);
  });

  it('fails clearly when the default pinned MetaMask artifact path is missing', () => {
    const cwd = tempRoot();
    expect(() => resolveWalletBrowserConfig({ cwd, env: {} })).toThrow(
      /MetaMask extension path does not exist.*METAMASK_EXTENSION_PATH or METAMASK_EXTENSION_DIR/
    );
    expect(() => resolveWalletBrowserConfig({ cwd, env: {} })).toThrow(/\[REDACTED_LOCAL_PATH\]/);
    expect(() => resolveWalletBrowserConfig({ cwd, env: {} })).not.toThrow(new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('resolves METAMASK_EXTENSION_PATH and creates the default isolated profile directory', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, '.wallet-extensions', 'metamask', '13.0.0');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask', version: '13.29.0' }));

    const config = resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } });

    expect(config.browserName).toBe('chromium');
    expect(config.metamaskExtensionPath).toBe(extensionPath);
    expect(config.metamaskExtensionIdentity).toEqual({ name: 'MetaMask', shortName: undefined, version: '13.29.0' });
    expect(config.profileDir).toBe(join(cwd, '.wallet-profiles', 'sepolia-burner'));
    expect(config.preserveProfile).toBe(false);
  });

  it('treats blank extension env overrides as absent like doctor diagnostics', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, '.wallet-extensions', 'metamask', PINNED_METAMASK_VERSION, 'chrome');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask', version: PINNED_METAMASK_VERSION }));

    const config = resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: '   ', METAMASK_EXTENSION_DIR: '' } });

    expect(config.metamaskExtensionPath).toBe(extensionPath);
  });

  it('allows explicit config options to override env values for library consumers', () => {
    const cwd = tempRoot();
    const envExtensionPath = join(cwd, 'env-extension');
    const configuredExtensionPath = join(cwd, 'configured-extension');
    const configuredProfileDir = join(cwd, 'configured-profile');
    mkdirSync(envExtensionPath, { recursive: true });
    mkdirSync(configuredExtensionPath, { recursive: true });
    writeFileSync(join(envExtensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Wrong MetaMask' }));
    writeFileSync(join(configuredExtensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask' }));

    const config = resolveWalletBrowserConfig({
      cwd,
      env: {
        METAMASK_EXTENSION_PATH: envExtensionPath,
        WALLET_PROFILE_DIR: join(cwd, 'env-profile'),
        PRESERVE_WALLET_PROFILE: 'false'
      },
      metamaskExtensionPath: configuredExtensionPath,
      metamaskExtensionVersion: '13.29.0-local',
      profileDir: configuredProfileDir,
      profileName: 'configured-agent',
      preserveProfile: true
    });

    expect(config.metamaskExtensionPath).toBe(configuredExtensionPath);
    expect(config.metamaskExtensionVersion).toBe('13.29.0-local');
    expect(config.profileDir).toBe(configuredProfileDir);
    expect(config.profileName).toBe('configured-agent');
    expect(config.preserveProfile).toBe(true);
  });

  it('supports legacy METAMASK_EXTENSION_DIR plus profile overrides without reading wallet secrets', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'extension');
    const profileDir = join(cwd, 'profile');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask' }));

    const config = resolveWalletBrowserConfig({
      cwd,
      env: {
        METAMASK_EXTENSION_DIR: extensionPath,
        WALLET_PROFILE_DIR: profileDir,
        PRESERVE_WALLET_PROFILE: 'true',
        SEPOLIA_WALLET_PRIVATE_KEY: 'should-not-be-needed',
        METAMASK_PASSWORD: 'should-not-be-needed'
      }
    });

    expect(config.profileDir).toBe(profileDir);
    expect(config.preserveProfile).toBe(true);
    expect(Object.keys(config)).not.toContain('privateKey');
    expect(Object.keys(config)).not.toContain('walletPassword');
  });

  it('rejects unsafe profile directories that point at the project root', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'extension');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask' }));

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath, WALLET_PROFILE_DIR: cwd } })).toThrow(
      /Wallet browser profile directory is unsafe/
    );
  });

  it('rejects unsafe profile directories that overlap the MetaMask extension artifact', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'extension');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask' }));

    expect(() =>
      resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath, WALLET_PROFILE_DIR: join(extensionPath, 'profile') } })
    ).toThrow(/Wallet browser profile directory must not overlap the MetaMask extension path/);
  });

  it('rejects extension directories without a manifest before preparing Chromium launch options', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'extension-without-manifest');
    mkdirSync(extensionPath, { recursive: true });

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } })).toThrow(
      /MetaMask extension manifest is missing/
    );
  });

  it('resolves localized Chrome extension names used by real MetaMask bundles', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'localized-metamask');
    mkdirSync(join(extensionPath, '_locales', 'en'), { recursive: true });
    writeFileSync(
      join(extensionPath, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: '__MSG_appName__', short_name: '__MSG_appName__', default_locale: 'en', version: '13.29.0' })
    );
    writeFileSync(
      join(extensionPath, '_locales', 'en', 'messages.json'),
      JSON.stringify({ appName: { message: 'MetaMask' } })
    );

    const config = resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } });

    expect(config.metamaskExtensionIdentity).toEqual({ name: 'MetaMask', shortName: 'MetaMask', version: '13.29.0' });
  });

  it('rejects traversal-style default MetaMask artifact versions in shared config', () => {
    expect(() => resolveWalletBrowserConfig({ cwd: tempRoot(), env: { METAMASK_EXTENSION_VERSION: '../../outside' } })).toThrow(
      /METAMASK_EXTENSION_VERSION must be a semver-like version string/
    );
  });

  it('rejects localized manifests whose default_locale escapes _locales in shared config', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'localized-metamask');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(
      join(extensionPath, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: '__MSG_appName__', default_locale: '../../outside', version: '13.29.0' })
    );

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } })).toThrow(/default_locale/);
  });

  it('rejects unpacked extension directories whose manifest does not identify MetaMask', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'not-metamask');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Some Other Wallet' }));

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } })).toThrow(
      /MetaMask extension manifest must identify MetaMask/
    );
  });

  it('rejects counterfeit extension manifests that only contain MetaMask as a substring', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'counterfeit-metamask');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Not MetaMask' }));

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } })).toThrow(
      /MetaMask extension manifest must identify MetaMask/
    );
  });

  it('rejects localized extension manifests when locale messages do not identify MetaMask', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'localized-other-wallet');
    mkdirSync(join(extensionPath, '_locales', 'en'), { recursive: true });
    writeFileSync(
      join(extensionPath, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: '__MSG_appName__', default_locale: 'en' })
    );
    writeFileSync(
      join(extensionPath, '_locales', 'en', 'messages.json'),
      JSON.stringify({ appName: { message: 'Some Other Wallet' } })
    );

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } })).toThrow(
      /MetaMask extension manifest must identify MetaMask/
    );
  });

  it('rejects MetaMask-looking extension manifests with an unsupported manifest version', () => {
    const cwd = tempRoot();
    const extensionPath = join(cwd, 'legacy-metamask');
    mkdirSync(extensionPath, { recursive: true });
    writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'MetaMask' }));

    expect(() => resolveWalletBrowserConfig({ cwd, env: { METAMASK_EXTENSION_PATH: extensionPath } })).toThrow(
      /MetaMask extension manifest_version must be 3/
    );
  });
});

describe('buildChromiumExtensionArgs', () => {
  it('constructs Chromium-only extension flags for the resolved extension path', () => {
    const extensionPath = '/tmp/metamask-extension';

    expect(buildChromiumExtensionArgs(extensionPath)).toEqual([
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]);
  });
});

describe('prepareChromiumLaunchOptions', () => {
  it('prepares persistent Chromium launch options with MetaMask loaded', () => {
    const launchOptions = prepareChromiumLaunchOptions({
      browserName: 'chromium',
      metamaskExtensionPath: '/tmp/metamask-extension',
      metamaskExtensionVersion: '13.29.0',
      metamaskExtensionIdentity: { name: 'MetaMask', version: '13.29.0' },
      profileDir: '/tmp/wallet-profile',
      profileName: 'sepolia-burner',
      preserveProfile: false
    });

    expect(launchOptions.browserName).toBe('chromium');
    expect(launchOptions.userDataDir).toBe('/tmp/wallet-profile');
    expect(launchOptions.options.headless).toBe(false);
    expect(launchOptions.options.args).toEqual([
      '--disable-extensions-except=/tmp/metamask-extension',
      '--load-extension=/tmp/metamask-extension'
    ]);
  });
});
