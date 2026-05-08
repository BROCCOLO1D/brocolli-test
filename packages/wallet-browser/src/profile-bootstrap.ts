import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWalletBrowserConfig, type WalletBrowserConfig, type WalletBrowserEnv } from './config.js';
import { resolveMetaMaskOnboardingConfig, type MetaMaskOnboardingConfig, type MetaMaskOnboardingEnv } from './onboarding.js';

export interface ProfileBootstrapImportEnv extends WalletBrowserEnv, MetaMaskOnboardingEnv {}

export interface ResolveProfileBootstrapImportOptions {
  cwd?: string;
  env?: ProfileBootstrapImportEnv;
  now?: Date;
}

export interface ProfileBootstrapImportManifest {
  artifactType: 'wallet-profile-bootstrap-import';
  status: 'dry-run';
  walletAddress: string;
  profileName: string;
  metamaskExtension: {
    version: string;
    identity: WalletBrowserConfig['metamaskExtensionIdentity'];
  };
  secrets: {
    privateKeyConfigured: boolean;
    passwordConfigured: boolean;
  };
  safetyNotes: string[];
}

export interface ProfileBootstrapImportDryRunResult {
  status: 'dry-run';
  manifestPath: string;
  manifest: ProfileBootstrapImportManifest;
}

export function maskEthereumAddress(address: string): string {
  const normalized = address.toLowerCase();
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function createProfileBootstrapImportManifest(
  walletConfig: WalletBrowserConfig,
  onboardingConfig: MetaMaskOnboardingConfig
): ProfileBootstrapImportManifest {
  return {
    artifactType: 'wallet-profile-bootstrap-import',
    status: 'dry-run',
    walletAddress: maskEthereumAddress(onboardingConfig.expectedAddress),
    profileName: walletConfig.profileName,
    metamaskExtension: {
      version: walletConfig.metamaskExtensionVersion,
      identity: walletConfig.metamaskExtensionIdentity
    },
    secrets: {
      privateKeyConfigured: onboardingConfig.privateKey.length > 0,
      passwordConfigured: onboardingConfig.password.length > 0
    },
    safetyNotes: [
      'No browser was launched and no private key or password was entered during this dry run.',
      'Generated artifacts are local-only under .wallet-artifacts and must remain ignored.',
      'Use only burner/testnet wallets and inspect artifacts before sharing any evidence.'
    ]
  };
}

export function createProfileBootstrapImportDryRun(
  options: ResolveProfileBootstrapImportOptions = {}
): ProfileBootstrapImportDryRunResult {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const onboardingConfig = resolveMetaMaskOnboardingConfig({ env });
  const walletConfig = resolveWalletBrowserConfig({ cwd, env });
  const manifest = createProfileBootstrapImportManifest(walletConfig, onboardingConfig);
  const runId = formatRunId(options.now ?? new Date());
  const artifactDir = join(cwd, '.wallet-artifacts', 'profile-bootstrap-import', runId);
  const manifestPath = join(artifactDir, 'BOOTSTRAP-MANIFEST.json');

  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  return { status: 'dry-run', manifestPath, manifest };
}

function formatRunId(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}
