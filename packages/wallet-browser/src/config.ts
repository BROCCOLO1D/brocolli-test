import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const PINNED_METAMASK_VERSION = '13.29.0';

export interface WalletBrowserEnv {
  [key: string]: string | undefined;
  METAMASK_EXTENSION_PATH?: string;
  METAMASK_EXTENSION_DIR?: string;
  METAMASK_EXTENSION_VERSION?: string;
  WALLET_PROFILE_DIR?: string;
  WALLET_PROFILE_NAME?: string;
  PRESERVE_WALLET_PROFILE?: string;
  SEPOLIA_WALLET_ADDRESS?: string;
  SEPOLIA_WALLET_PRIVATE_KEY?: string;
  METAMASK_PASSWORD?: string;
  METAMASK_ONBOARDING_TIMEOUT_MS?: string;
  METAMASK_ONBOARDING_DEBUG?: string;
  SEPOLIA_CHAIN_ID?: string;
  SEPOLIA_RPC_URL?: string;
  METAMASK_NETWORK_ASSERTION_TIMEOUT_MS?: string;
  METAMASK_NETWORK_DEBUG?: string;
}

export interface ResolveWalletBrowserConfigOptions {
  cwd?: string;
  env?: WalletBrowserEnv;
  metamaskExtensionPath?: string;
  metamaskExtensionDir?: string;
  metamaskExtensionVersion?: string;
  profileDir?: string;
  profileName?: string;
  preserveProfile?: boolean;
}

export interface MetaMaskExtensionIdentity {
  name: string;
  shortName?: string;
  version?: string;
}

export interface WalletBrowserConfig {
  browserName: 'chromium';
  metamaskExtensionPath: string;
  metamaskExtensionVersion: string;
  metamaskExtensionIdentity: MetaMaskExtensionIdentity;
  profileDir: string;
  profileName: string;
  preserveProfile: boolean;
}

const DEFAULT_PROFILE_NAME = 'sepolia-burner';

export function resolveWalletBrowserConfig(options: ResolveWalletBrowserConfigOptions = {}): WalletBrowserConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const metamaskExtensionVersion = options.metamaskExtensionVersion?.trim() || env.METAMASK_EXTENSION_VERSION?.trim() || PINNED_METAMASK_VERSION;
  const extensionPathValue =
    options.metamaskExtensionPath ??
    options.metamaskExtensionDir ??
    env.METAMASK_EXTENSION_PATH ??
    env.METAMASK_EXTENSION_DIR ??
    defaultMetamaskExtensionPath(metamaskExtensionVersion);

  const metamaskExtensionPath = resolve(cwd, extensionPathValue);
  assertDirectory(metamaskExtensionPath, 'MetaMask extension path');
  const metamaskExtensionIdentity = readMetaMaskManifestIdentity(metamaskExtensionPath);

  const profileName = sanitizeProfileName(options.profileName ?? env.WALLET_PROFILE_NAME ?? DEFAULT_PROFILE_NAME);
  const profileDir = resolve(cwd, options.profileDir ?? env.WALLET_PROFILE_DIR ?? `.wallet-profiles/${profileName}`);
  assertSafeProfileDir(profileDir, cwd, metamaskExtensionPath);
  mkdirSync(profileDir, { recursive: true });
  assertDirectory(profileDir, 'Wallet browser profile directory');

  return {
    browserName: 'chromium',
    metamaskExtensionPath,
    metamaskExtensionVersion,
    metamaskExtensionIdentity,
    profileDir,
    profileName,
    preserveProfile: options.preserveProfile ?? parseBoolean(env.PRESERVE_WALLET_PROFILE)
  };
}

function defaultMetamaskExtensionPath(version: string): string {
  return join('.wallet-extensions', 'metamask', version, 'chrome');
}

function assertDirectory(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(
      `${label} does not exist: ${path}. Set METAMASK_EXTENSION_PATH or METAMASK_EXTENSION_DIR to an unpacked MetaMask extension directory, or prepare the pinned default artifact under ${defaultMetamaskExtensionPath(PINNED_METAMASK_VERSION)}.`
    );
  }

  if (!statSync(path).isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

function assertSafeProfileDir(profileDir: string, cwd: string, metamaskExtensionPath: string): void {
  const root = parse(profileDir).root;
  if (profileDir === root || profileDir === resolve(cwd)) {
    throw new Error('Wallet browser profile directory is unsafe; use an isolated directory under .wallet-profiles or an explicit wallet profile root.');
  }

  if (isSamePathOrChild(profileDir, metamaskExtensionPath) || isSamePathOrChild(metamaskExtensionPath, profileDir)) {
    throw new Error('Wallet browser profile directory must not overlap the MetaMask extension path.');
  }
}

function isSamePathOrChild(candidatePath: string, parentPath: string): boolean {
  const relation = relative(parentPath, candidatePath);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation) && !relation.startsWith(sep));
}

function readMetaMaskManifestIdentity(extensionPath: string): MetaMaskExtensionIdentity {
  const manifestPath = join(extensionPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`MetaMask extension manifest is missing: ${manifestPath}`);
  }

  const manifest = readManifest(manifestPath);
  if (manifest.manifest_version !== 3) {
    throw new Error(`MetaMask extension manifest_version must be 3: ${manifestPath}`);
  }

  const rawName = typeof manifest.name === 'string' ? manifest.name : '';
  const rawShortName = typeof manifest.short_name === 'string' ? manifest.short_name : '';
  const localeMessages = readLocaleMessages(extensionPath, manifest);
  const name = resolveManifestText(rawName, localeMessages);
  const shortName = resolveManifestText(rawShortName, localeMessages);
  if (!/metamask/i.test(`${name} ${shortName}`)) {
    throw new Error(`MetaMask extension manifest must identify MetaMask: ${manifestPath}`);
  }

  const identity: MetaMaskExtensionIdentity = { name };
  if (shortName !== '') {
    identity.shortName = shortName;
  }
  if (typeof manifest.version === 'string' && manifest.version.trim() !== '') {
    identity.version = manifest.version;
  }

  return identity;
}

function readLocaleMessages(extensionPath: string, manifest: Record<string, unknown>): Record<string, string> {
  const defaultLocale = typeof manifest.default_locale === 'string' ? manifest.default_locale.trim() : '';
  if (defaultLocale === '') {
    return {};
  }

  const messagesPath = join(extensionPath, '_locales', defaultLocale, 'messages.json');
  if (!existsSync(messagesPath)) {
    return {};
  }

  const messages = readManifest(messagesPath);
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const message = (value as Record<string, unknown>).message;
      if (typeof message === 'string') {
        resolved[key] = message;
      }
    }
  }

  return resolved;
}

function resolveManifestText(value: string, localeMessages: Record<string, string>): string {
  return value.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (match, key: string) => localeMessages[key] ?? match);
}

function readManifest(manifestPath: string): Record<string, unknown> {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest root is not an object');
    }

    return manifest as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `MetaMask extension manifest must be valid JSON: ${manifestPath}${error instanceof Error ? ` (${error.message})` : ''}`
    );
  }
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function sanitizeProfileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return DEFAULT_PROFILE_NAME;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error('WALLET_PROFILE_NAME may only contain letters, numbers, dots, underscores, and hyphens.');
  }

  return trimmed;
}
