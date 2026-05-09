import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { chromium } from 'playwright';

import { PINNED_METAMASK_VERSION, type WalletBrowserEnv } from './config.js';

export type WalletBrowserDoctorStatus = 'ok' | 'warning' | 'error';

export interface WalletBrowserDoctorCheck {
  id: string;
  label: string;
  status: WalletBrowserDoctorStatus;
  summary: string;
  action?: string;
}

export interface WalletBrowserDoctorReport {
  status: WalletBrowserDoctorStatus;
  checks: WalletBrowserDoctorCheck[];
  env: {
    envFile: {
      path: string;
      present: boolean;
      keys: string[];
    };
    runtime: {
      present: string[];
      missing: string[];
    };
  };
  paths: {
    profileDir?: string;
    metamaskExtensionPath?: string;
    chromiumExecutablePath?: string;
  };
  notes: string[];
}

export interface CreateWalletBrowserDoctorReportOptions {
  cwd?: string;
  env?: WalletBrowserEnv;
  nodeVersion?: string;
}

const DOCTOR_ENV_KEYS = [
  'METAMASK_EXTENSION_PATH',
  'METAMASK_EXTENSION_DIR',
  'METAMASK_EXTENSION_VERSION',
  'WALLET_PROFILE_DIR',
  'WALLET_PROFILE_NAME',
  'PRESERVE_WALLET_PROFILE',
  'SEPOLIA_WALLET_ADDRESS',
  'SEPOLIA_WALLET_PRIVATE_KEY',
  'METAMASK_PASSWORD',
  'SEPOLIA_CHAIN_ID',
  'SEPOLIA_RPC_URL'
] as const;

const REQUIRED_GITIGNORE_PATTERNS = ['.env', '.wallet-profiles/', '.wallet-extensions/', '.wallet-artifacts/'] as const;

export function createWalletBrowserDoctorReport(options: CreateWalletBrowserDoctorReportOptions = {}): WalletBrowserDoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const checks: WalletBrowserDoctorCheck[] = [];
  const paths: WalletBrowserDoctorReport['paths'] = {};

  checks.push(checkNodeVersion(options.nodeVersion ?? process.version));

  const playwrightCheck = checkPlaywrightChromium();
  checks.push(playwrightCheck.check);
  if (playwrightCheck.chromiumExecutablePath) {
    paths.chromiumExecutablePath = redactLocalPath(playwrightCheck.chromiumExecutablePath);
  }

  const envFile = summarizeEnvFile(cwd);
  checks.push({
    id: 'env-file',
    label: '.env file',
    status: envFile.present ? 'ok' : 'warning',
    summary: envFile.present
      ? `.env is present with ${envFile.keys.length} configured key${envFile.keys.length === 1 ? '' : 's'}; values are intentionally omitted.`
      : '.env was not found; runtime environment variables will still be honored.',
    action: envFile.present ? undefined : 'Create a local .env from README examples when you need persistent wallet testnet settings; never commit it.'
  });

  const runtimeEnv = summarizeRuntimeEnv(env);
  checks.push({
    id: 'runtime-env',
    label: 'wallet runtime environment',
    status: runtimeEnv.present.length > 0 ? 'ok' : 'warning',
    summary: runtimeEnv.present.length > 0
      ? `Runtime env has ${runtimeEnv.present.length} wallet setup key${runtimeEnv.present.length === 1 ? '' : 's'} configured; values are intentionally omitted.`
      : 'No wallet setup runtime variables are configured.',
    action: runtimeEnv.present.length > 0 ? undefined : 'Set METAMASK_EXTENSION_PATH or run pnpm wallet:metamask:fetch to prepare the pinned default MetaMask artifact.'
  });

  const metamaskCheck = checkMetaMaskExtension(cwd, env);
  checks.push(metamaskCheck.check);
  if (metamaskCheck.metamaskExtensionPath) {
    paths.metamaskExtensionPath = redactLocalPath(metamaskCheck.metamaskExtensionPath);
  }
  if (metamaskCheck.profileDir) {
    paths.profileDir = redactLocalPath(metamaskCheck.profileDir);
  }

  checks.push(checkProfileDirectory(cwd, env));
  checks.push(checkGitignore(cwd));

  const status = summarizeStatus(checks);
  return {
    status,
    checks,
    env: {
      envFile,
      runtime: runtimeEnv
    },
    paths,
    notes: [
      'Doctor never launches Chromium, imports wallets, unlocks MetaMask, connects accounts, signs messages, or sends transactions.',
      'Secret values from .env and process env are not printed; only key names and redacted setup state are reported.',
      'Local filesystem paths are redacted from doctor JSON so reports can be shared safely.'
    ]
  };
}

function checkNodeVersion(version: string): WalletBrowserDoctorCheck {
  const normalized = version.trim().replace(/^v/, '');
  const major = Number.parseInt(normalized.split('.')[0] ?? '', 10);
  if (major === 22) {
    return {
      id: 'node',
      label: 'Node.js version',
      status: 'ok',
      summary: `Node ${version} satisfies @broccolo1d/wallet-browser engine >=22 <23.`
    };
  }

  return {
    id: 'node',
    label: 'Node.js version',
    status: 'error',
    summary: `Node ${version} does not satisfy @broccolo1d/wallet-browser engine >=22 <23.`,
    action: 'Install and use Node 22.x before running wallet-browser setup or smoke commands.'
  };
}

function checkPlaywrightChromium(): { check: WalletBrowserDoctorCheck; chromiumExecutablePath?: string } {
  try {
    const executablePath = chromium.executablePath();
    if (executablePath.trim() === '') {
      return {
        check: {
          id: 'playwright-chromium',
          label: 'Playwright Chromium',
          status: 'error',
          summary: 'Playwright is installed but did not report a Chromium executable path.',
          action: 'Run pnpm exec playwright install chromium, then rerun npx wallet-browser doctor.'
        }
      };
    }

    return {
      chromiumExecutablePath: executablePath,
      check: {
        id: 'playwright-chromium',
        label: 'Playwright Chromium',
        status: existsSync(executablePath) ? 'ok' : 'warning',
        summary: existsSync(executablePath)
          ? 'Playwright can resolve an installed Chromium executable.'
          : 'Playwright can resolve a Chromium executable path, but the binary was not found on disk.',
        action: existsSync(executablePath) ? undefined : 'Run pnpm exec playwright install chromium before browser smoke runs.'
      }
    };
  } catch (error) {
    return {
      check: {
        id: 'playwright-chromium',
        label: 'Playwright Chromium',
        status: 'error',
        summary: `Playwright Chromium diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
        action: 'Install dependencies with pnpm install, then run pnpm exec playwright install chromium.'
      }
    };
  }
}

function checkMetaMaskExtension(cwd: string, env: WalletBrowserEnv): { check: WalletBrowserDoctorCheck; metamaskExtensionPath?: string; profileDir?: string } {
  try {
    const configuredVersion = normalizeMetaMaskExtensionVersion(env.METAMASK_EXTENSION_VERSION?.trim() || PINNED_METAMASK_VERSION);
    const explicitExtensionPath = firstNonBlank(env.METAMASK_EXTENSION_PATH, env.METAMASK_EXTENSION_DIR);
    const extensionPathValue = explicitExtensionPath ?? defaultMetamaskExtensionPath(configuredVersion);
    const usesDefaultExtensionArtifact = explicitExtensionPath === undefined;
    const metamaskExtensionPath = resolve(cwd, extensionPathValue);
    const profileDir = resolveProfileDir(cwd, env);
    assertDirectoryExists(metamaskExtensionPath, 'MetaMask extension path');
    const identity = readMetaMaskManifestIdentity(metamaskExtensionPath);
    if (usesDefaultExtensionArtifact && identity.version !== configuredVersion) {
      throw new Error(`MetaMask extension manifest version must match configured version for default artifact ${redactLocalPath(metamaskExtensionPath)}: expected ${configuredVersion}, found ${identity.version ?? 'missing'}.`);
    }
    return {
      metamaskExtensionPath,
      profileDir,
      check: {
        id: 'metamask-extension',
        label: 'MetaMask extension artifact',
        status: 'ok',
        summary: `MetaMask extension manifest is valid${identity.version ? ` (${identity.version})` : ''}.`
      }
    };
  } catch (error) {
    const message = redactDoctorMessage(error instanceof Error ? error.message : String(error), env, cwd);
    return {
      check: {
        id: 'metamask-extension',
        label: 'MetaMask extension artifact',
        status: 'error',
        summary: message,
        action: `Run pnpm wallet:metamask:fetch to populate .wallet-extensions/metamask/${PINNED_METAMASK_VERSION}/chrome, or set METAMASK_EXTENSION_PATH to an unpacked MetaMask MV3 extension directory.`
      }
    };
  }
}

function checkProfileDirectory(cwd: string, env: WalletBrowserEnv): WalletBrowserDoctorCheck {
  try {
    const configuredVersion = normalizeMetaMaskExtensionVersion(env.METAMASK_EXTENSION_VERSION?.trim() || PINNED_METAMASK_VERSION);
    const profileDir = resolveProfileDir(cwd, env);
    const extensionPathValue = firstNonBlank(env.METAMASK_EXTENSION_PATH, env.METAMASK_EXTENSION_DIR) ?? defaultMetamaskExtensionPath(configuredVersion);
    const metamaskExtensionPath = resolve(cwd, extensionPathValue);
    assertSafeProfileDir(profileDir, cwd, metamaskExtensionPath);
    if (!existsSync(profileDir)) {
      return {
        id: 'wallet-profile-dir',
        label: 'wallet profile directory',
        status: 'warning',
        summary: 'Wallet profile directory does not exist yet; setup/smoke commands can create it later. Doctor does not create files.',
        action: 'Run wallet setup or smoke commands only after .gitignore protects .wallet-profiles/.'
      };
    }
    if (!statSync(profileDir).isDirectory()) {
      throw new Error('configured wallet profile path is not a directory');
    }
    return {
      id: 'wallet-profile-dir',
      label: 'wallet profile directory',
      status: 'ok',
      summary: 'Wallet profile directory already exists and is isolated from source-controlled files.'
    };
  } catch (error) {
    return {
      id: 'wallet-profile-dir',
      label: 'wallet profile directory',
      status: 'error',
      summary: `Wallet profile directory is not usable: ${redactDoctorMessage(error instanceof Error ? error.message : String(error), env, cwd)}`,
      action: 'Set WALLET_PROFILE_DIR to a writable local-only directory, preferably under .wallet-profiles/.'
    };
  }
}

function checkGitignore(cwd: string): WalletBrowserDoctorCheck {
  const gitignorePath = join(cwd, '.gitignore');
  let gitignore = '';
  try {
    gitignore = readFileSync(gitignorePath, 'utf8');
  } catch {
    return {
      id: 'gitignore-wallet-artifacts',
      label: 'local wallet artifacts ignored',
      status: 'error',
      summary: '.gitignore is missing, so wallet profiles, extension artifacts, and .env are not protected from accidental commits.',
      action: `Create .gitignore entries for ${REQUIRED_GITIGNORE_PATTERNS.join(', ')}.`
    };
  }

  const missing = REQUIRED_GITIGNORE_PATTERNS.filter((pattern) => !gitignoreIncludesPattern(gitignore, pattern));
  if (missing.length === 0) {
    return {
      id: 'gitignore-wallet-artifacts',
      label: 'local wallet artifacts ignored',
      status: 'ok',
      summary: '.gitignore protects .env, wallet profiles, extension artifacts, and smoke artifacts.'
    };
  }

  return {
    id: 'gitignore-wallet-artifacts',
    label: 'local wallet artifacts ignored',
    status: 'error',
    summary: `.gitignore is missing wallet-local pattern${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    action: `Add ${missing.join(', ')} to .gitignore before running wallet setup commands.`
  };
}

function defaultMetamaskExtensionPath(version: string): string {
  normalizeMetaMaskExtensionVersion(version);
  return join('.wallet-extensions', 'metamask', version, 'chrome');
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '') return trimmed;
  }
  return undefined;
}

function normalizeMetaMaskExtensionVersion(value: string): string {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
    throw new Error('METAMASK_EXTENSION_VERSION must be a semver-like version string without path separators.');
  }
  return version;
}

function resolveProfileDir(cwd: string, env: WalletBrowserEnv): string {
  const profileName = sanitizeProfileName(env.WALLET_PROFILE_NAME?.trim() || 'sepolia-burner');
  return resolve(cwd, env.WALLET_PROFILE_DIR?.trim() || `.wallet-profiles/${profileName}`);
}

function assertDirectoryExists(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${redactLocalPath(path)}.`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`${label} must be a directory: ${redactLocalPath(path)}.`);
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

function readMetaMaskManifestIdentity(extensionPath: string): { name: string; shortName?: string; version?: string } {
  const manifestPath = join(extensionPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`MetaMask extension manifest is missing: ${redactLocalPath(manifestPath)}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  if (manifest.manifest_version !== 3) {
    throw new Error(`MetaMask extension manifest_version must be 3: ${redactLocalPath(manifestPath)}.`);
  }
  const localeMessages = readLocaleMessages(extensionPath, manifest);
  const name = resolveManifestText(typeof manifest.name === 'string' ? manifest.name : '', localeMessages).trim();
  const shortName = resolveManifestText(typeof manifest.short_name === 'string' ? manifest.short_name : '', localeMessages).trim();
  if (name.trim().toLowerCase() !== 'metamask' && shortName.trim().toLowerCase() !== 'metamask') {
    throw new Error(`MetaMask extension manifest must identify MetaMask: ${redactLocalPath(manifestPath)}.`);
  }
  const identity: { name: string; shortName?: string; version?: string } = { name: name || 'MetaMask' };
  if (shortName) identity.shortName = shortName;
  if (typeof manifest.version === 'string' && manifest.version.trim() !== '') identity.version = manifest.version;
  return identity;
}

function readLocaleMessages(extensionPath: string, manifest: Record<string, unknown>): Record<string, string> {
  const defaultLocale = typeof manifest.default_locale === 'string' ? manifest.default_locale.trim() : '';
  if (defaultLocale === '') {
    return {};
  }
  if (!/^[A-Za-z0-9_@-]+$/.test(defaultLocale)) {
    throw new Error('MetaMask extension default_locale contains unsupported characters.');
  }
  const localesRoot = resolve(extensionPath, '_locales');
  const messagesPath = resolve(localesRoot, defaultLocale, 'messages.json');
  if (!isSamePathOrChild(messagesPath, localesRoot)) {
    throw new Error('MetaMask extension default_locale resolves outside the _locales directory.');
  }
  if (!existsSync(messagesPath)) {
    return {};
  }
  const messages = JSON.parse(readFileSync(messagesPath, 'utf8')) as Record<string, unknown>;
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

function sanitizeProfileName(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error('WALLET_PROFILE_NAME may only contain letters, numbers, dots, underscores, and hyphens.');
  }
  return value;
}

function redactLocalPath(value: string): string {
  return value ? '[REDACTED_LOCAL_PATH]' : value;
}

function summarizeEnvFile(cwd: string): WalletBrowserDoctorReport['env']['envFile'] {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) {
    return { path: '.env', present: false, keys: [] };
  }

  const keys = new Set<string>();
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
    if (match?.[1]) {
      keys.add(match[1]);
    }
  }

  return { path: '.env', present: true, keys: [...keys].sort() };
}

function summarizeRuntimeEnv(env: WalletBrowserEnv): WalletBrowserDoctorReport['env']['runtime'] {
  const present: string[] = [];
  const missing: string[] = [];
  for (const key of DOCTOR_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      present.push(key);
    } else {
      missing.push(key);
    }
  }
  return { present, missing };
}

function gitignoreIncludesPattern(gitignore: string, pattern: string): boolean {
  return gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .includes(pattern);
}

function summarizeStatus(checks: WalletBrowserDoctorCheck[]): WalletBrowserDoctorStatus {
  if (checks.some((check) => check.status === 'error')) {
    return 'error';
  }
  if (checks.some((check) => check.status === 'warning')) {
    return 'warning';
  }
  return 'ok';
}

function redactDoctorMessage(message: string, env: WalletBrowserEnv, cwd?: string): string {
  let redacted = cwd ? message.replaceAll(cwd, '[REDACTED_LOCAL_PATH]') : message;
  for (const [key, rawValue] of Object.entries(env)) {
    const value = rawValue?.trim();
    if (value && value.length >= 4) {
      redacted = redacted.replaceAll(value, `[redacted:${key}]`);
    }
  }
  return redacted.replace(/(?:[A-Za-z]:)?\/?(?:[^\s:]+\/){2,}[^\s:)]*/g, '[REDACTED_LOCAL_PATH]');
}
