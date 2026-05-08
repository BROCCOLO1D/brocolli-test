export {
  PINNED_METAMASK_VERSION,
  resolveWalletBrowserConfig,
  type MetaMaskExtensionIdentity,
  type ResolveWalletBrowserConfigOptions,
  type WalletBrowserConfig,
  type WalletBrowserEnv
} from './config.js';

export {
  buildChromiumExtensionArgs,
  launchWalletBrowser,
  prepareChromiumLaunchOptions,
  type PreparedChromiumLaunchOptions,
  type WalletBrowserLaunchResult
} from './launcher.js';

export {
  discoverMetaMaskExtensionPage,
  getMetaMaskExtensionPagePath,
  waitForMetaMaskExtensionPage,
  type DiscoverMetaMaskExtensionPageOptions,
  type ExtensionBrowserContextLike,
  type ExtensionPageLike,
  type MetaMaskExtensionPagePath,
  type WaitForMetaMaskExtensionPageOptions
} from './extension-pages.js';

export {
  captureFixtureExtensionSmokeScreenshots,
  captureMetaMaskSmokeScreenshots,
  resolveDefaultFixtureDappSmokeUrl,
  writeSmokeArtifactManifest,
  verifySmokeArtifactManifest,
  writeSmokeInspectionGuide,
  type MetaMaskSmokeOptions,
  type MetaMaskSmokeResult,
  type MetaMaskSmokeScreenshot,
  type RunMetaMaskSmoke
} from './metamask-smoke.js';

export {
  DEFAULT_METAMASK_PROMPT_SELECTORS,
  approveMetaMaskConnectionPrompt,
  assertMetaMaskConnectionPromptText,
  createMetaMaskPromptDriver,
  type MetaMaskPromptDriverOptions,
  type MetaMaskPromptLocatorLike,
  type MetaMaskPromptPageLike,
  type MetaMaskPromptSelectors
} from './metamask-prompts.js';

export {
  FIXTURE_CONNECTION_PROOF_MANIFEST,
  verifyFixtureConnectionProofManifest,
  type FixtureConnectionProofEvidence,
  type FixtureConnectionProofScreenshot,
  type FixtureConnectionProofVerificationResult
} from './fixture-proof.js';
export {
  runFixtureConnectionProof,
  type FixtureConnectionScreenshotCaptureInput,
  type RunFixtureConnectionProofOptions
} from './fixture-harness.js';

export { runWalletBrowserCli, type WalletBrowserCliOptions } from './cli.js';

export {
  DEFAULT_METAMASK_ONBOARDING_TIMEOUT_MS,
  METAMASK_ONBOARDING_SELECTORS,
  createMetaMaskOnboardingPlan,
  createMetaMaskPageDriver,
  findMetaMaskExtensionPage,
  importPrivateKeyIntoMetaMaskPage,
  isMetaMaskExtensionPageUrl,
  maskSecret,
  resolveMetaMaskOnboardingConfig,
  runMetaMaskOnboarding,
  unlockMetaMaskPage,
  validateEthereumAddress,
  validateMetaMaskPassword,
  validatePrivateKey,
  verifyMetaMaskActiveAddress,
  type MetaMaskImportPrivateKeyInput,
  type MetaMaskExtensionPageDiscoveryOptions,
  type MetaMaskOnboardingConfig,
  type MetaMaskOnboardingDriver,
  type MetaMaskOnboardingEnv,
  type MetaMaskOnboardingResult,
  type MetaMaskOnboardingState,
  type MetaMaskOnboardingStatus,
  type MetaMaskPageDriverOptions,
  type MetaMaskUnlockInput,
  type RedactedMetaMaskOnboardingPlan,
  type ResolveMetaMaskOnboardingConfigOptions
} from './onboarding.js';

export {
  DEFAULT_ALLOWED_WALLET_CHAIN_IDS,
  DEFAULT_NETWORK_ASSERTION_TIMEOUT_MS,
  DEFAULT_SEPOLIA_CHAIN_ID,
  assertExpectedChainAndAccount,
  chainIdToHex,
  createMetaMaskNetworkPageDriver,
  createSepoliaAddChainInput,
  createSepoliaNetworkPlan,
  isAllowedWalletChainId,
  normalizeChainId,
  normalizeExpectedAccount,
  provisionSepoliaNetwork,
  redactRpcUrl,
  resolveSepoliaNetworkConfig,
  validateOptionalRpcUrl,
  type AddEthereumChainInput,
  type MetaMaskNetworkDriver,
  type MetaMaskNetworkPageDriverOptions,
  type RedactedSepoliaNetworkPlan,
  type ResolveSepoliaNetworkConfigOptions,
  type SepoliaNetworkAssertionResult,
  type SepoliaNetworkConfig,
  type SepoliaNetworkEnv
} from './network.js';

export {
  createProfileBootstrapImportDryRun,
  createProfileBootstrapImportManifest,
  maskEthereumAddress,
  type ProfileBootstrapImportDryRunResult,
  type ProfileBootstrapImportEnv,
  type ProfileBootstrapImportManifest,
  type ResolveProfileBootstrapImportOptions
} from './profile-bootstrap.js';

export {
  approveSignature,
  approveTransaction,
  assertWalletState,
  connectWallet,
  createWalletDappPageDriver,
  resetProfile,
  switchNetwork,
  type ApproveSignatureOptions,
  type ApproveTransactionOptions,
  type ConnectWalletOptions,
  type ConnectWalletResult,
  type ResetProfileOptions,
  type ResetProfileResult,
  type WalletConnectionPromptInput,
  type WalletControlAction,
  type WalletControlLogEvent,
  type WalletControlLogStatus,
  type WalletControlLogger,
  type WalletDappDriver,
  type WalletDappPageDriverOptions,
  type WalletGuardrailConfig,
  type WalletDappPageDriverSelectors,
  type WalletDappPageLike,
  type WalletDappPageLocator,
  type WalletPromptDriver,
  type WalletSignaturePromptInput,
  type WalletSignatureRequestInput,
  type WalletStateOptions,
  type WalletTransactionPromptInput,
  type WalletTransactionRequestInput
} from './wallet-control.js';
