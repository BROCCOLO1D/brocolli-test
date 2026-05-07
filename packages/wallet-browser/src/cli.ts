#!/usr/bin/env node
import { prepareChromiumLaunchOptions } from './launcher.js';
import { resolveWalletBrowserConfig, type WalletBrowserEnv } from './config.js';

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
  profileDir: string;
  profileName: string;
  preserveProfile: boolean;
}

const USAGE = `Usage:
  wallet-browser prepare

Print a sanitized Chromium persistent-context launch plan for the pinned MetaMask extension profile.
This Phase 2 CLI does not launch Chromium, import wallets, read private keys, or read .env files.
`;

export async function runWalletBrowserCli(options: WalletBrowserCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const command = argv[0] ?? 'prepare';

  if (command === '--help' || command === '-h' || command === 'help') {
    stdout(USAGE);
    return 0;
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
      profileDir: config.profileDir,
      profileName: config.profileName,
      preserveProfile: config.preserveProfile
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
