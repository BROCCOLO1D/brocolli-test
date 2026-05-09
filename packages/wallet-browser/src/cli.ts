#!/usr/bin/env node
import { prepareChromiumLaunchOptions } from './launcher.js';
import { resolveWalletBrowserConfig, type WalletBrowserEnv } from './config.js';
import { createMetaMaskOnboardingPlan, resolveMetaMaskOnboardingConfig } from './onboarding.js';
import { createSepoliaNetworkPlan, resolveSepoliaNetworkConfig } from './network.js';
import { createProfileBootstrapImportDryRun } from './profile-bootstrap.js';
import { verifyFixtureConnectionProofManifest } from './fixture-proof.js';
import {
  captureFixtureExtensionSmokeScreenshots,
  captureMetaMaskSmokeScreenshots,
  verifySmokeArtifactManifest,
  type RunMetaMaskSmoke
} from './metamask-smoke.js';

export interface WalletBrowserCliOptions {
  argv?: string[];
  cwd?: string;
  env?: WalletBrowserEnv;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  runMetaMaskSmoke?: RunMetaMaskSmoke;
  runFixtureExtensionSmoke?: RunMetaMaskSmoke;
}

interface WalletBrowserLaunchPlanJson {
  browserName: 'chromium';
  userDataDir: string;
  args: string[];
  metamaskExtensionPath: string;
  metamaskExtensionVersion: string;
  metamaskExtensionIdentity: {
    name: string;
    shortName?: string;
    version?: string;
  };
  profileDir: string;
  profileName: string;
  preserveProfile: boolean;
  config: {
    present: string[];
    missing: string[];
  };
}

const PREPARE_CONFIG_KEYS = [
  'METAMASK_EXTENSION_PATH',
  'METAMASK_EXTENSION_DIR',
  'METAMASK_EXTENSION_VERSION',
  'WALLET_PROFILE_DIR',
  'WALLET_PROFILE_NAME',
  'PRESERVE_WALLET_PROFILE'
] as const;

const PREPARE_ERROR_REDACT_KEYS = ['METAMASK_EXTENSION_PATH', 'METAMASK_EXTENSION_DIR', 'WALLET_PROFILE_DIR'] as const;

const USAGE = `Usage:
  wallet-browser prepare
  wallet-browser smoke-metamask
  wallet-browser smoke-fixture-extension
  wallet-browser verify-smoke-artifacts <artifact-dir>
  wallet-browser verify-fixture-proof <artifact-dir>
  wallet-browser onboarding-plan
  wallet-browser profile-bootstrap-import --dry-run
  wallet-browser network-plan

Print a sanitized Chromium persistent-context launch plan for the pinned MetaMask extension profile,
launch real Chromium with MetaMask loaded and capture local-only smoke screenshots,
launch real Chromium with a generated fake extension to prove extension-loading mechanics only,
print a redacted MetaMask onboarding plan for the configured burner wallet, or print a
redacted Sepolia network provisioning plan.
The prepare command does not launch Chromium. The smoke-metamask command launches Chromium but
never imports, unlocks, connects, signs, or transacts. Plan commands validate injected environment/config
and never print raw private keys, wallet passwords, or RPC tokens.
`;

function summarizePrepareConfig(env: WalletBrowserEnv): { present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];

  for (const key of PREPARE_CONFIG_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  return { present, missing };
}

function redactPrepareError(message: string, env: WalletBrowserEnv): string {
  let redacted = message;

  for (const key of PREPARE_ERROR_REDACT_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      redacted = redacted.replaceAll(value, `[redacted:${key}]`);
    }
  }

  return redacted;
}

export async function runWalletBrowserCli(options: WalletBrowserCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const command = argv[0] ?? 'prepare';

  if (command === '--help' || command === '-h' || command === 'help') {
    stdout(USAGE);
    return 0;
  }

  if (command === 'smoke-metamask') {
    try {
      const runSmoke = options.runMetaMaskSmoke ?? captureMetaMaskSmokeScreenshots;
      const result = await runSmoke({ cwd: options.cwd, env: options.env });
      stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${redactPrepareError(error instanceof Error ? error.message : String(error), options.env ?? process.env)}\n`);
      return 1;
    }
  }

  if (command === 'smoke-fixture-extension') {
    try {
      const runSmoke = options.runFixtureExtensionSmoke ?? captureFixtureExtensionSmokeScreenshots;
      const result = await runSmoke({ cwd: options.cwd, env: options.env });
      stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${redactPrepareError(error instanceof Error ? error.message : String(error), options.env ?? process.env)}\n`);
      return 1;
    }
  }

  if (command === 'verify-smoke-artifacts') {
    const artifactDir = argv[1];
    if (!artifactDir) {
      stderr(`Missing artifact directory for verify-smoke-artifacts.\n\n${USAGE}`);
      return 1;
    }
    try {
      const result = verifySmokeArtifactManifest(artifactDir);
      stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (command === 'verify-fixture-proof') {
    const artifactDir = argv[1];
    if (!artifactDir) {
      stderr(`Missing artifact directory for verify-fixture-proof.\n\n${USAGE}`);
      return 1;
    }
    try {
      const result = verifyFixtureConnectionProofManifest(artifactDir);
      const publicResult = { ...result, artifactDir: '[redacted:artifact-dir]', manifestPath: '[redacted:manifest-path]' };
      stdout(`${JSON.stringify(publicResult, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (command === 'onboarding-plan') {
    try {
      const onboardingConfig = resolveMetaMaskOnboardingConfig({ env: options.env });
      const plan = createMetaMaskOnboardingPlan(onboardingConfig);
      stdout(`${JSON.stringify(plan, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (command === 'profile-bootstrap-import') {
    if (!argv.includes('--dry-run')) {
      stderr('profile-bootstrap-import currently requires --dry-run; real browser import automation is intentionally not run by this command yet.\n');
      return 1;
    }
    try {
      const result = createProfileBootstrapImportDryRun({ cwd: options.cwd, env: options.env });
      stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${redactPrepareError(error instanceof Error ? error.message : String(error), options.env ?? process.env)}\n`);
      return 1;
    }
  }

  if (command === 'network-plan') {
    try {
      const networkConfig = resolveSepoliaNetworkConfig({ env: options.env });
      const plan = createSepoliaNetworkPlan(networkConfig);
      stdout(`${JSON.stringify(plan, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }


  if (command !== 'prepare') {
    stderr(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  try {
    const config = resolveWalletBrowserConfig({ cwd: options.cwd, env: options.env });
    const launchOptions = prepareChromiumLaunchOptions(config);
    const plan: WalletBrowserLaunchPlanJson = {
      browserName: launchOptions.browserName,
      userDataDir: launchOptions.userDataDir,
      args: [...(launchOptions.options.args ?? [])],
      metamaskExtensionPath: config.metamaskExtensionPath,
      metamaskExtensionVersion: config.metamaskExtensionVersion,
      metamaskExtensionIdentity: config.metamaskExtensionIdentity,
      profileDir: config.profileDir,
      profileName: config.profileName,
      preserveProfile: config.preserveProfile,
      config: summarizePrepareConfig(options.env ?? process.env)
    };

    stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`${redactPrepareError(message, options.env ?? process.env)}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runWalletBrowserCli();
}
