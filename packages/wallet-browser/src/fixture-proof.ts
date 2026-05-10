import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DEFAULT_SEPOLIA_CHAIN_ID } from './network.js';

export const FIXTURE_CONNECTION_PROOF_MANIFEST = 'FIXTURE-PROOF-MANIFEST.json';
const WALLET_BROWSER_PACKAGE_VERSION = '0.2.5';

function runtimeMetadata(): NonNullable<FixtureConnectionProofManifest['provenance']>['runtime'] {
  return { node: process.version, platform: process.platform, arch: process.arch };
}

export interface FixtureConnectionProofEvidence {
  connectionState: 'connected';
  maskedAccount: string;
  chainId: number;
  origin: string;
}

export interface FixtureConnectionProofScreenshot {
  label: 'fixture-connected';
  file: string;
  sizeBytes: number;
  sha256: string;
}

interface FixtureConnectionProofManifest {
  schemaVersion: 1;
  createdAt: string;
  runId: string;
  provenance: {
    packageName: '@broccolo1d/wallet-browser';
    packageVersion: string;
    framework: 'wallet-browser';
    tool: string;
    runtime: {
      node: string;
      platform: string;
      arch: string;
    };
  };
  artifactType: 'fixture-dapp-wallet-connection-proof';
  target: 'fixture-dapp';
  status: 'connected';
  evidence: FixtureConnectionProofEvidence;
  screenshots: FixtureConnectionProofScreenshot[];
  notes?: string[];
}

export interface FixtureConnectionProofVerificationResult {
  status: 'verified';
  artifactDir: string;
  manifestPath: string;
  manifestSha256: string;
  schemaVersion: 1;
  createdAt: string;
  runId: string;
  provenance: FixtureConnectionProofManifest['provenance'];
  evidence: FixtureConnectionProofEvidence;
  screenshots: FixtureConnectionProofScreenshot[];
  notes: string[];
}

export function verifyFixtureConnectionProofManifest(artifactDir: string): FixtureConnectionProofVerificationResult {
  const manifestPath = join(artifactDir, FIXTURE_CONNECTION_PROOF_MANIFEST);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifestSha256 = createHash('sha256').update(manifestText).digest('hex');
  if (manifestText.includes(artifactDir)) {
    throw new Error('Fixture connection proof manifest must not contain the full artifact directory path.');
  }
  if (containsLocalPathLeak(manifestText)) {
    throw new Error('Fixture connection proof manifest must not contain local path leaks.');
  }
  if (containsSecretLeak(manifestText)) {
    throw new Error('Fixture connection proof manifest must not contain raw secrets or tokens.');
  }

  const manifest = JSON.parse(manifestText) as FixtureConnectionProofManifest;
  if (manifest.schemaVersion === undefined) {
    throw new Error('Fixture connection proof schemaVersion is required for verification.');
  }
  verifyFixtureProofProvenance(manifest);
  if (manifest.artifactType !== 'fixture-dapp-wallet-connection-proof') {
    throw new Error('Fixture connection proof manifest has an unexpected artifact type.');
  }
  if (manifest.target !== 'fixture-dapp') {
    throw new Error('Fixture connection proof manifest has an unexpected target.');
  }
  if (manifest.status !== 'connected' || manifest.evidence?.connectionState !== 'connected') {
    throw new Error('Fixture connection proof must show connected fixture state before it can be accepted.');
  }
  if (manifest.evidence.chainId !== DEFAULT_SEPOLIA_CHAIN_ID) {
    throw new Error(`Fixture connection proof must be captured on Sepolia chain ${DEFAULT_SEPOLIA_CHAIN_ID}.`);
  }
  if (!isMaskedAccount(manifest.evidence.maskedAccount)) {
    throw new Error('Fixture connection proof masked account must be shortened and must not contain a full wallet address.');
  }
  if (containsFullAddress(manifestText)) {
    throw new Error('Fixture connection proof manifest must not contain full wallet addresses.');
  }
  if (!isSafeOrigin(manifest.evidence.origin)) {
    throw new Error('Fixture connection proof origin must be a safe http(s) origin or local fixture URL without query strings.');
  }
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length === 0) {
    throw new Error('Fixture connection proof manifest must list at least one screenshot.');
  }

  const screenshots = manifest.screenshots.map((screenshot) => verifyFixtureProofScreenshot(artifactDir, screenshot));
  if (!screenshots.some((screenshot) => screenshot.label === 'fixture-connected')) {
    throw new Error('Fixture connection proof manifest must include a fixture-connected screenshot.');
  }

  return {
    status: 'verified',
    artifactDir,
    manifestPath,
    manifestSha256,
    schemaVersion: manifest.schemaVersion,
    createdAt: manifest.createdAt,
    runId: manifest.runId,
    provenance: manifest.provenance,
    evidence: manifest.evidence,
    screenshots,
    notes: Array.isArray(manifest.notes) ? manifest.notes : []
  };
}

function verifyFixtureProofProvenance(manifest: FixtureConnectionProofManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error('Fixture connection proof schemaVersion is unsupported.');
  }
  if (!manifest.createdAt || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Fixture connection proof createdAt provenance is required.');
  }
  if (!manifest.runId || typeof manifest.runId !== 'string') {
    throw new Error('Fixture connection proof runId provenance is required.');
  }
  if (manifest.provenance?.packageName !== '@broccolo1d/wallet-browser' || manifest.provenance.framework !== 'wallet-browser' || !manifest.provenance.tool) {
    throw new Error('Fixture connection proof provenance is incomplete.');
  }
  if (manifest.provenance.packageVersion !== WALLET_BROWSER_PACKAGE_VERSION) {
    throw new Error('Fixture connection proof package version provenance is inconsistent.');
  }
  const runtime = manifest.provenance.runtime;
  const expectedRuntime = runtimeMetadata();
  if (!runtime || runtime.node !== expectedRuntime.node || runtime.platform !== expectedRuntime.platform || runtime.arch !== expectedRuntime.arch) {
    throw new Error('Fixture connection proof runtime provenance is inconsistent.');
  }
}

function verifyFixtureProofScreenshot(artifactDir: string, screenshot: FixtureConnectionProofScreenshot): FixtureConnectionProofScreenshot {
  if (screenshot.label !== 'fixture-connected') {
    throw new Error(`Fixture connection proof manifest contains an unexpected screenshot label: ${String(screenshot.label)}`);
  }
  if (!isSafeArtifactFileName(screenshot.file)) {
    throw new Error(`Fixture connection proof screenshot file must be a safe basename: ${String(screenshot.file)}`);
  }
  const screenshotPath = join(artifactDir, screenshot.file);
  if (!existsSync(screenshotPath)) {
    throw new Error(`Fixture connection proof screenshot is missing: ${screenshot.file}`);
  }
  const bytes = readFileSync(screenshotPath);
  const sizeBytes = statSync(screenshotPath).size;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (screenshot.sizeBytes !== sizeBytes) {
    throw new Error(`Fixture connection proof screenshot size mismatch for ${screenshot.file}.`);
  }
  if (screenshot.sha256 !== sha256) {
    throw new Error(`Fixture connection proof screenshot hash mismatch for ${screenshot.file}.`);
  }
  return { ...screenshot, sizeBytes, sha256 };
}

function isMaskedAccount(value: string): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{4}(?:…|\.\.\.)[0-9a-fA-F]{4,5}$/.test(value) && !containsFullAddress(value);
}

function containsFullAddress(value: string): boolean {
  return /0x[0-9a-fA-F]{40}/.test(value);
}

function containsLocalPathLeak(text: string): boolean {
  return /file:\/\/\//i.test(text)
    || /(?:^|[\s"'`([{<])(?:[A-Za-z]:\\|\\\\)[^\s"'`)\]}>]+/.test(text)
    || /(?:^|[\s"'`([{<])\/(?!\/)(?:[^/\s"'`)\]}>]+\/)+[^/\s"'`)\]}>]*/.test(text);
}

function containsSecretLeak(text: string): boolean {
  return /\bnpm_[A-Za-z0-9_-]{20,}\b/.test(text)
    || /\b0x[0-9a-fA-F]{64}\b/.test(text)
    || /\b(?:private[_-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|secret|token|rpc(?:[_-]?url)?)\b\s*(?::|=|is|was)?\s+(?:[A-Za-z][A-Za-z0-9_-]{5,}|[0-9a-fA-F]{64}|https?:\/\/\S+)/i.test(text)
    || /https?:\/\/[^\s"'`]*\/(?:[^\s"'`]*[A-Za-z0-9_-]{20,}[^\s"'`]*)/i.test(text)
    || /https?:\/\/[^\s"'`]+[?&](?:api[_-]?key|token|key|auth|access[_-]?token)=[^\s"'`&]+/i.test(text)
    || /https?:\/\/[^\s"'`]+:[^\s"'`@]+@[^\s"'`]+/i.test(text);
}

function isSafeOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.search === '' && parsed.hash === '';
  } catch {
    return false;
  }
}

function isSafeArtifactFileName(fileName: string): boolean {
  return typeof fileName === 'string' && fileName.length > 0 && fileName === basename(fileName) && !fileName.includes('..');
}
