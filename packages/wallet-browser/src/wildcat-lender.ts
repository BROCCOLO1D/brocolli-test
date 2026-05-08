import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DEFAULT_SEPOLIA_CHAIN_ID, chainIdToHex, resolveSepoliaNetworkConfig, type SepoliaNetworkEnv } from './network.js';
import { maskEthereumAddress } from './profile-bootstrap.js';

export const WILDCAT_LENDER_URL = 'https://testnet.wildcat.finance/lender';
export const WILDCAT_LENDER_ARTIFACT_DIR = '.wallet-artifacts/wildcat-lender/<run-id>';
export const WILDCAT_LENDER_MANIFEST = 'WILDCAT-LENDER-MANIFEST.json';

export interface WildcatLenderConnectionPlanOptions {
  cwd?: string;
  env?: SepoliaNetworkEnv;
}

export interface WildcatLenderConnectionPlanStep {
  action:
    | 'open-target'
    | 'dismiss-common-modals'
    | 'click-connect-wallet'
    | 'select-metamask'
    | 'approve-metamask-connect'
    | 'verify-wallet-state'
    | 'capture-connected-proof';
  description: string;
  selectors?: readonly string[];
  guardrail?: string;
}

export interface WildcatLenderConnectionPlan {
  status: 'local-only-plan';
  target: 'wildcat-lender';
  url: typeof WILDCAT_LENDER_URL;
  expectedChainId: number;
  expectedChainIdHex: string;
  expectedMaskedAccount: string;
  allowedOrigins: readonly string[];
  maxTransactionValueWei: '0';
  artifactDir: typeof WILDCAT_LENDER_ARTIFACT_DIR;
  steps: readonly WildcatLenderConnectionPlanStep[];
  diagnostics: readonly string[];
  safetyNotes: readonly string[];
}

export interface WildcatLenderConnectedEvidence {
  connectionState: 'connected';
  maskedAccount: string;
  chainId: number;
  origin: typeof WILDCAT_LENDER_URL;
}

export interface WildcatLenderScreenshot {
  label: 'wildcat-connected';
  file: string;
  sizeBytes: number;
  sha256: string;
}

export type WildcatLenderFailureBlocker =
  | 'connect-modal-selection'
  | 'metamask-notification-discovery'
  | 'metamask-connect-approval'
  | 'wallet-state-guardrail'
  | 'wildcat-provider-state'
  | 'live-site-unavailable'
  | 'unknown';

export interface WildcatLenderFailureEvidence {
  blocker: WildcatLenderFailureBlocker;
  stage: WildcatLenderConnectionPlanStep['action'];
  safeMessage: string;
}

interface WildcatLenderArtifactManifest {
  artifactType: 'wildcat-lender-wallet-connection-proof';
  target: 'wildcat-lender';
  status: 'connected' | 'failed';
  evidence?: WildcatLenderConnectedEvidence;
  failure?: WildcatLenderFailureEvidence;
  screenshots?: WildcatLenderScreenshot[];
  diagnostics?: string[];
}

export interface WildcatLenderArtifactVerificationResult {
  status: 'verified-connected' | 'verified-failed';
  target: 'wildcat-lender';
  artifactDir: string;
  manifestPath: string;
  evidence?: WildcatLenderConnectedEvidence;
  failure?: WildcatLenderFailureEvidence;
  screenshots: WildcatLenderScreenshot[];
  diagnostics: string[];
}

export function createWildcatLenderConnectionPlan(
  options: WildcatLenderConnectionPlanOptions = {}
): WildcatLenderConnectionPlan {
  const network = resolveSepoliaNetworkConfig({ env: options.env, chainId: DEFAULT_SEPOLIA_CHAIN_ID });
  return {
    status: 'local-only-plan',
    target: 'wildcat-lender',
    url: WILDCAT_LENDER_URL,
    expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
    expectedChainIdHex: chainIdToHex(DEFAULT_SEPOLIA_CHAIN_ID),
    expectedMaskedAccount: maskEthereumAddress(network.expectedAccount),
    allowedOrigins: [WILDCAT_LENDER_URL],
    maxTransactionValueWei: '0',
    artifactDir: WILDCAT_LENDER_ARTIFACT_DIR,
    steps: createWildcatPlanSteps(),
    diagnostics: [
      'Run only against an ignored local MetaMask burner profile; do not preserve browser profiles, traces, or screenshots in Git.',
      'If the live site is flaky or unavailable, preserve only the redacted manifest and local screenshots under ignored .wallet-artifacts/.',
      'A successful proof must show the connected lender page after shared MetaMask prompt discovery and wallet state verification, not loading, onboarding, or disconnected UI.'
    ],
    safetyNotes: [
      'This command is a deterministic plan only; it does not launch Chromium, import wallets, connect, sign, or transact.',
      'The future live harness must keep max transaction value at zero wei and fail closed on any transaction, signature, unknown prompt, wrong origin, wrong account, or wrong network.',
      'Artifacts belong under .wallet-artifacts/wildcat-lender/<run-id>/ and must remain local-only until manually inspected and scanned.'
    ]
  };
}

export function verifyWildcatLenderArtifactManifest(artifactDir: string): WildcatLenderArtifactVerificationResult {
  const manifestPath = join(artifactDir, WILDCAT_LENDER_MANIFEST);
  const manifestText = readFileSync(manifestPath, 'utf8');
  if (manifestText.includes(artifactDir)) {
    throw new Error('Wildcat lender manifest must not contain the full artifact directory path.');
  }
  if (containsFullAddress(manifestText)) {
    throw new Error('Wildcat lender manifest must not contain full wallet addresses.');
  }

  const manifest = JSON.parse(manifestText) as WildcatLenderArtifactManifest;
  if (manifest.artifactType !== 'wildcat-lender-wallet-connection-proof') {
    throw new Error('Wildcat lender manifest has an unexpected artifact type.');
  }
  if (manifest.target !== 'wildcat-lender') {
    throw new Error('Wildcat lender manifest has an unexpected target.');
  }
  const diagnostics = verifySafeStringList(manifest.diagnostics ?? [], 'diagnostic');

  if (manifest.status === 'connected') {
    const evidence = verifyConnectedEvidence(manifest.evidence);
    const screenshots = verifyConnectedScreenshots(artifactDir, manifest.screenshots ?? []);
    return {
      status: 'verified-connected',
      target: 'wildcat-lender',
      artifactDir,
      manifestPath,
      evidence,
      screenshots,
      diagnostics
    };
  }

  if (manifest.status === 'failed') {
    const failure = verifyFailureEvidence(manifest.failure);
    if (Array.isArray(manifest.screenshots) && manifest.screenshots.length > 0) {
      throw new Error('Failed Wildcat lender manifests must not claim connected screenshots.');
    }
    return {
      status: 'verified-failed',
      target: 'wildcat-lender',
      artifactDir,
      manifestPath,
      failure,
      screenshots: [],
      diagnostics
    };
  }

  throw new Error('Wildcat lender manifest status must be connected or failed.');
}

function createWildcatPlanSteps(): readonly WildcatLenderConnectionPlanStep[] {
  return [
    {
      action: 'open-target',
      description: 'Open the Wildcat testnet lender page in the persistent Chromium profile.',
      guardrail: `Only navigate to ${WILDCAT_LENDER_URL}.`
    },
    {
      action: 'dismiss-common-modals',
      description: 'Dismiss common consent, terms, cookie, or network warning modals if they appear.',
      selectors: [
        'button:has-text("Accept")',
        'button:has-text("Agree")',
        'button:has-text("I understand")',
        'button:has-text("Close")'
      ],
      guardrail: 'Only click visible modal dismissal buttons with benign consent/close text.'
    },
    {
      action: 'click-connect-wallet',
      description: 'Click the Wildcat connect wallet entry point.',
      selectors: ['button:has-text("Connect Wallet")', 'button:has-text("Connect")'],
      guardrail: 'Fail closed if the page does not expose an explicit connect-wallet action.'
    },
    {
      action: 'select-metamask',
      description: 'Select MetaMask from the wallet chooser.',
      selectors: ['button:has-text("MetaMask")', '[data-testid*="metamask" i]'],
      guardrail: 'Fail closed if MetaMask is not an explicit wallet option.'
    },
    {
      action: 'approve-metamask-connect',
      description: 'Approve only the shared MetaMask connection prompt discovered on notification.html.',
      guardrail: `Prompt text must include ${WILDCAT_LENDER_URL} and must not look like a signature or transaction prompt.`
    },
    {
      action: 'verify-wallet-state',
      description: 'Assert Sepolia chain 11155111 and the configured burner account before declaring success.',
      guardrail: 'Fail closed on wrong chain, wrong account, unknown prompt, or any transaction/value request.'
    },
    {
      action: 'capture-connected-proof',
      description: 'Capture local-only diagnostics after the Wildcat lender UI shows connected state with a masked account.',
      guardrail: 'Screenshot and manifest must be redacted, local-only, and stored under ignored .wallet-artifacts/wildcat-lender/.'
    }
  ];
}

function verifyConnectedEvidence(evidence: WildcatLenderConnectedEvidence | undefined): WildcatLenderConnectedEvidence {
  if (!evidence || evidence.connectionState !== 'connected') {
    throw new Error('Connected Wildcat lender proof must include connected evidence.');
  }
  if (evidence.chainId !== DEFAULT_SEPOLIA_CHAIN_ID) {
    throw new Error(`Connected Wildcat lender proof must be captured on Sepolia chain ${DEFAULT_SEPOLIA_CHAIN_ID}.`);
  }
  if (evidence.origin !== WILDCAT_LENDER_URL) {
    throw new Error(`Connected Wildcat lender proof must use the Wildcat lender origin ${WILDCAT_LENDER_URL}.`);
  }
  if (!isMaskedAccount(evidence.maskedAccount)) {
    throw new Error('Connected Wildcat lender proof must use a masked account and must not contain a full wallet address.');
  }
  return evidence;
}

function verifyFailureEvidence(failure: WildcatLenderFailureEvidence | undefined): WildcatLenderFailureEvidence {
  if (!failure) {
    throw new Error('Failed Wildcat lender manifest must include failure evidence.');
  }
  const blockers: readonly WildcatLenderFailureBlocker[] = [
    'connect-modal-selection',
    'metamask-notification-discovery',
    'metamask-connect-approval',
    'wallet-state-guardrail',
    'wildcat-provider-state',
    'live-site-unavailable',
    'unknown'
  ];
  if (!blockers.includes(failure.blocker)) {
    throw new Error(`Wildcat lender failure blocker is not recognized: ${String(failure.blocker)}`);
  }
  const stages = createWildcatPlanSteps().map((step) => step.action);
  if (!stages.includes(failure.stage)) {
    throw new Error(`Wildcat lender failure stage is not recognized: ${String(failure.stage)}`);
  }
  if (!isSafeMessage(failure.safeMessage)) {
    throw new Error('Wildcat lender failure safeMessage must be redacted and must not contain paths, URLs with tokens, or full addresses.');
  }
  return failure;
}

function verifyConnectedScreenshots(artifactDir: string, screenshots: WildcatLenderScreenshot[]): WildcatLenderScreenshot[] {
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    throw new Error('Connected Wildcat lender proof must include at least one screenshot.');
  }
  const verified = screenshots.map((screenshot) => verifyScreenshot(artifactDir, screenshot));
  if (!verified.some((screenshot) => screenshot.label === 'wildcat-connected')) {
    throw new Error('Connected Wildcat lender proof must include a wildcat-connected screenshot.');
  }
  return verified;
}

function verifyScreenshot(artifactDir: string, screenshot: WildcatLenderScreenshot): WildcatLenderScreenshot {
  if (screenshot.label !== 'wildcat-connected') {
    throw new Error(`Wildcat lender screenshot has an unexpected label: ${String(screenshot.label)}`);
  }
  if (!isSafeArtifactFileName(screenshot.file)) {
    throw new Error(`Wildcat lender screenshot file must be a safe basename: ${String(screenshot.file)}`);
  }
  const screenshotPath = join(artifactDir, screenshot.file);
  if (!existsSync(screenshotPath)) {
    throw new Error(`Wildcat lender screenshot is missing: ${screenshot.file}`);
  }
  const bytes = readFileSync(screenshotPath);
  const sizeBytes = statSync(screenshotPath).size;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (screenshot.sizeBytes !== sizeBytes) {
    throw new Error(`Wildcat lender screenshot size mismatch for ${screenshot.file}.`);
  }
  if (screenshot.sha256 !== sha256) {
    throw new Error(`Wildcat lender screenshot hash mismatch for ${screenshot.file}.`);
  }
  return { ...screenshot, sizeBytes, sha256 };
}

function verifySafeStringList(values: string[], label: string): string[] {
  if (!Array.isArray(values)) {
    throw new Error(`Wildcat lender ${label} entries must be an array.`);
  }
  for (const value of values) {
    if (!isSafeMessage(value)) {
      throw new Error(`Wildcat lender ${label} entries must be redacted and path-safe.`);
    }
  }
  return values;
}

function isSafeMessage(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && !containsFullAddress(value) && !/\/[\w.-]+\//.test(value) && !/https?:\/\/[^\s]+\?.+/.test(value);
}

function isMaskedAccount(value: string): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{4}(?:…|\.\.\.)[0-9a-fA-F]{4,5}$/.test(value) && !containsFullAddress(value);
}

function containsFullAddress(value: string): boolean {
  return /0x[0-9a-fA-F]{40}/.test(value);
}

function isSafeArtifactFileName(fileName: string): boolean {
  return typeof fileName === 'string' && fileName.length > 0 && fileName === basename(fileName) && !fileName.includes('..');
}
