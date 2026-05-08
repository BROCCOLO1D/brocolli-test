#!/usr/bin/env node
import { prepareChromiumLaunchOptions } from './launcher.js';
import { resolveWalletBrowserConfig, type WalletBrowserEnv } from './config.js';
import { createMetaMaskOnboardingPlan, resolveMetaMaskOnboardingConfig } from './onboarding.js';
import { createSepoliaNetworkPlan, resolveSepoliaNetworkConfig } from './network.js';

export interface WalletBrowserCliOptions {
  argv?: string[];
  cwd?: string;
  env?: WalletBrowserEnv;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
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

const USAGE = `Usage:
  wallet-browser prepare
  wallet-browser onboarding-plan
  wallet-browser network-plan

Print a sanitized Chromium persistent-context launch plan for the pinned MetaMask extension profile,
print a redacted MetaMask onboarding plan for the configured burner wallet, or print a
redacted Sepolia network provisioning plan.
The prepare command does not launch Chromium. Plan commands validate injected environment/config
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

export async function runWalletBrowserCli(options: WalletBrowserCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const command = argv[0] ?? 'prepare';

  if (command === '--help' || command === '-h' || command === 'help') {
    stdout(USAGE);
    return 0;
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
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runWalletBrowserCli();
}
