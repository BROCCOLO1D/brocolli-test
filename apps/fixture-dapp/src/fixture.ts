export const CONNECT_WALLET_BUTTON_TEST_ID = 'connect-wallet-button';
export const CONNECTED_ACCOUNT_TEST_ID = 'connected-account';
export const CURRENT_CHAIN_TEST_ID = 'current-chain';
export const SIGN_MESSAGE_BUTTON_TEST_ID = 'sign-message-button';
export const SIGN_MESSAGE_STATUS_TEST_ID = 'sign-message-status';
export const SEND_TRANSACTION_BUTTON_TEST_ID = 'send-transaction-button';
export const SEND_TRANSACTION_STATUS_TEST_ID = 'send-transaction-status';
export const STATUS_OUTPUT_TEST_ID = 'status-output';

export const DEFAULT_SIGN_MESSAGE = 'Fixture dapp sign-in';
export const SUPPORTED_TRANSACTION_CHAIN_IDS = ['0xaa36a7', '0x7a69', '0x539'] as const;

export interface FixtureSelectors {
  connectButton: string;
  connectedAccount: string;
  currentChain: string;
  signMessageButton: string;
  signMessageStatus: string;
  sendTransactionButton: string;
  sendTransactionStatus: string;
  statusOutput: string;
}

export interface ValueTransactionInput {
  from: string;
  chainId: string | number;
  to?: string;
  value?: string;
}

export interface MinimalValueTransaction {
  from: string;
  to: string;
  value: string;
}

export function selectorFor(testId: string): string {
  return `[data-testid="${testId}"]`;
}

export function getFixtureSelectors(): FixtureSelectors {
  return {
    connectButton: selectorFor(CONNECT_WALLET_BUTTON_TEST_ID),
    connectedAccount: selectorFor(CONNECTED_ACCOUNT_TEST_ID),
    currentChain: selectorFor(CURRENT_CHAIN_TEST_ID),
    signMessageButton: selectorFor(SIGN_MESSAGE_BUTTON_TEST_ID),
    signMessageStatus: selectorFor(SIGN_MESSAGE_STATUS_TEST_ID),
    sendTransactionButton: selectorFor(SEND_TRANSACTION_BUTTON_TEST_ID),
    sendTransactionStatus: selectorFor(SEND_TRANSACTION_STATUS_TEST_ID),
    statusOutput: selectorFor(STATUS_OUTPUT_TEST_ID)
  };
}

export function formatAccount(account: string | undefined): string {
  if (!account) {
    return 'not connected';
  }
  return account.toLowerCase();
}

export function normalizeHexChainId(chainId: string | number | undefined): string | undefined {
  if (chainId === undefined) {
    return undefined;
  }
  if (typeof chainId === 'number') {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error('chain id must be a positive safe integer');
    }
    return `0x${chainId.toString(16)}`;
  }
  const trimmed = chainId.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(trimmed)) {
    throw new Error('chain id must be a 0x-prefixed hex string');
  }
  return trimmed;
}

export function formatChainId(chainId: string | number | undefined): string {
  const hex = normalizeHexChainId(chainId);
  if (!hex) {
    return 'unknown';
  }
  const decimal = Number.parseInt(hex.slice(2), 16);
  const label = hex === '0xaa36a7' ? 'Sepolia' : hex === '0x7a69' || hex === '0x539' ? 'Local devnet' : 'Unknown chain';
  return `${label} (${decimal} / ${hex})`;
}

export function utf8ToHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function buildPersonalSignParams(account: string, message = DEFAULT_SIGN_MESSAGE): [string, string] {
  return [utf8ToHex(message), account.toLowerCase()];
}

export function isSupportedTransactionChainId(chainId: string | number): boolean {
  const hex = normalizeHexChainId(chainId);
  return hex !== undefined && SUPPORTED_TRANSACTION_CHAIN_IDS.includes(hex as (typeof SUPPORTED_TRANSACTION_CHAIN_IDS)[number]);
}

export function assertSupportedTransactionChainId(chainId: string | number): void {
  const hex = normalizeHexChainId(chainId);
  if (!hex || !isSupportedTransactionChainId(hex)) {
    throw new Error(`Unsupported fixture transaction chain: ${hex ?? 'unknown'}`);
  }
}

export function buildValueTransaction(input: ValueTransactionInput): MinimalValueTransaction {
  assertSupportedTransactionChainId(input.chainId);
  // This fixture intentionally sends a zero-value transaction back to the active account by default.
  // Wallet automation can validate prompt plumbing without transferring Sepolia funds.
  return {
    from: input.from.toLowerCase(),
    to: (input.to ?? input.from).toLowerCase(),
    value: input.value ?? '0x0'
  };
}
