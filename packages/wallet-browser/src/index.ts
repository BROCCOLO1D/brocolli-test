export {
  PINNED_METAMASK_VERSION,
  resolveWalletBrowserConfig,
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
  approveSignature,
  approveTransaction,
  assertWalletState,
  connectWallet,
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
  type WalletPromptDriver,
  type WalletSignaturePromptInput,
  type WalletSignatureRequestInput,
  type WalletStateOptions,
  type WalletTransactionPromptInput,
  type WalletTransactionRequestInput
} from './wallet-control.js';
