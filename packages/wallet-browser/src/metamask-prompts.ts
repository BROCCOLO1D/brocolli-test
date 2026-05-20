import { waitForMetaMaskExtensionPage, type ExtensionBrowserContextLike, type ExtensionPageLike } from './extension-pages.js';
import { type WalletConnectionPromptInput, type WalletPromptDriver, type WalletSignaturePromptInput } from './wallet-control.js';

export interface MetaMaskPromptLocatorLike {
  textContent?(): Promise<string | null>;
  isVisible?(): Promise<boolean>;
  click?(): Promise<void>;
}

export interface MetaMaskPromptPageLike extends ExtensionPageLike {
  locator(selector: string): MetaMaskPromptLocatorLike;
}

export interface MetaMaskPromptSelectors {
  pageText: string;
  nextButtonCandidates: readonly string[];
  connectButtonCandidates: readonly string[];
  signatureButtonCandidates: readonly string[];
}

export interface MetaMaskPromptDriverOptions {
  context: ExtensionBrowserContextLike;
  extensionId?: string;
  timeoutMs?: number;
  ensureKeeperPage?: boolean;
  selectors?: Partial<MetaMaskPromptSelectors>;
}

export type WalletPromptKind = 'connect' | 'switch-chain' | 'add-chain' | 'sign' | 'transaction' | 'token-approval' | 'unknown';

export interface MetaMaskPromptClassification {
  kind: WalletPromptKind;
  matchedMarker?: string;
}

export const DEFAULT_METAMASK_PROMPT_SELECTORS: MetaMaskPromptSelectors = {
  pageText: 'body',
  nextButtonCandidates: [
    '[data-testid="page-container-footer-next"]',
    'button:has-text("Next")'
  ],
  connectButtonCandidates: [
    '[data-testid="page-container-footer-connect"]',
    '[data-testid="page-container-footer-confirm"]',
    'button:has-text("Connect")'
  ],
  signatureButtonCandidates: [
    '[data-testid="page-container-footer-confirm"]',
    '[data-testid="confirm-footer-button"]',
    'button:has-text("Sign")',
    'button:has-text("Confirm")'
  ]
};

const CONNECTION_PROMPT_MARKERS = [
  'connect with metamask',
  'connect to',
  'wants to connect',
  'permissions request'
] as const;

const NON_CONNECTION_PROMPT_MARKERS = [
  'confirm transaction',
  'send transaction',
  'transaction request',
  'signature request',
  'sign message',
  'personal_sign',
  'spending cap',
  'approve token',
  'edit permission'
] as const;

const SWITCH_CHAIN_PROMPT_MARKERS = [
  'switch network',
  'switch to',
  'allow this site to switch the network',
  'network switch'
] as const;

const ADD_CHAIN_PROMPT_MARKERS = [
  'add network',
  'add a network',
  'allow this site to add a network',
  'network will be added'
] as const;

const TRANSACTION_PROMPT_MARKERS = [
  'confirm transaction',
  'send transaction',
  'transaction request'
] as const;

const TOKEN_APPROVAL_PROMPT_MARKERS = [
  'spending cap',
  'approve token',
  'edit permission',
  'give permission to access your tokens'
] as const;

export function createMetaMaskPromptDriver(options: MetaMaskPromptDriverOptions): WalletPromptDriver {
  return {
    async approveConnection(input) {
      const page = await waitForMetaMaskExtensionPage(options.context, {
        extensionId: options.extensionId,
        preferredPath: '/notification.html',
        timeoutMs: options.timeoutMs,
        ensureKeeperPage: options.ensureKeeperPage ?? true
      });
      await approveMetaMaskConnectionPrompt(page as MetaMaskPromptPageLike, input, mergePromptSelectors(options.selectors));
    },
    async approveSignature(input) {
      const page = await waitForMetaMaskExtensionPage(options.context, {
        extensionId: options.extensionId,
        preferredPath: '/notification.html',
        timeoutMs: options.timeoutMs,
        ensureKeeperPage: options.ensureKeeperPage ?? true
      });
      await approveMetaMaskSignaturePrompt(page as MetaMaskPromptPageLike, input, mergePromptSelectors(options.selectors));
    }
  };
}

export async function approveMetaMaskConnectionPrompt(
  page: MetaMaskPromptPageLike,
  input: WalletConnectionPromptInput,
  selectors: MetaMaskPromptSelectors = DEFAULT_METAMASK_PROMPT_SELECTORS
): Promise<void> {
  const promptText = await readPromptText(page, selectors.pageText);
  assertMetaMaskConnectionPromptText(promptText, input.origin);

  const nextButton = await findVisibleClickable(page, selectors.nextButtonCandidates);
  if (nextButton) {
    await nextButton.click?.();
  }

  const connectButton = await findVisibleClickable(page, selectors.connectButtonCandidates);
  if (!connectButton) {
    throw new Error('MetaMask connect approval button was not visible; refusing to approve unknown prompt state.');
  }
  await connectButton.click?.();
}

export function assertMetaMaskConnectionPromptText(promptText: string, expectedOrigin?: string): void {
  const normalizedText = promptText.toLowerCase();
  const classification = classifyMetaMaskPromptText(promptText);
  if (classification.kind !== 'connect') {
    const unexpectedMarker = classification.matchedMarker && NON_CONNECTION_PROMPT_MARKERS.includes(classification.matchedMarker as typeof NON_CONNECTION_PROMPT_MARKERS[number])
      ? classification.matchedMarker
      : undefined;
    if (unexpectedMarker) {
      throw new Error(`Unexpected MetaMask prompt marker "${unexpectedMarker}" while expecting a connection prompt; refusing to click.`);
    }
    throw new Error('MetaMask notification page did not look like a connection prompt; refusing to click.');
  }

  const expectedOriginMarker = normalizeExpectedOriginMarker(expectedOrigin);
  if (expectedOriginMarker && !normalizedText.includes(expectedOriginMarker.toLowerCase())) {
    throw new Error(`Expected dapp origin ${expectedOriginMarker} was not found in MetaMask connection prompt; refusing to click.`);
  }
}

const SIGNATURE_PROMPT_MARKERS = [
  'signature request',
  'sign message',
  'sign this message',
  'personal_sign',
  'eth_signtypeddata',
  'typed data signature'
] as const;

const NON_SIGNATURE_PROMPT_MARKERS = [
  'connect with metamask',
  'wants to connect',
  'permissions request',
  'confirm transaction',
  'send transaction',
  'transaction request',
  'spending cap',
  'approve token',
  'edit permission'
] as const;

export function classifyMetaMaskPromptText(promptText: string): MetaMaskPromptClassification {
  const normalizedText = promptText.toLowerCase();
  const orderedChecks: readonly [WalletPromptKind, readonly string[]][] = [
    ['token-approval', TOKEN_APPROVAL_PROMPT_MARKERS],
    ['transaction', TRANSACTION_PROMPT_MARKERS],
    ['sign', SIGNATURE_PROMPT_MARKERS],
    ['add-chain', ADD_CHAIN_PROMPT_MARKERS],
    ['switch-chain', SWITCH_CHAIN_PROMPT_MARKERS],
    ['connect', CONNECTION_PROMPT_MARKERS]
  ];

  const matches = orderedChecks.flatMap(([kind, markers]) => {
    const matchedMarker = markers.find((marker) => normalizedText.includes(marker));
    return matchedMarker ? [{ kind, matchedMarker }] : [];
  });

  const matchedKinds = new Set(matches.map((match) => match.kind));
  if (matchedKinds.size !== 1) {
    return { kind: 'unknown' };
  }

  return matches[0];
}

export async function approveMetaMaskSignaturePrompt(
  page: MetaMaskPromptPageLike,
  input: WalletSignaturePromptInput,
  selectors: MetaMaskPromptSelectors = DEFAULT_METAMASK_PROMPT_SELECTORS
): Promise<void> {
  const promptText = await readPromptText(page, selectors.pageText);
  assertMetaMaskSignaturePromptText(promptText, input);

  const nextButton = await findVisibleClickable(page, selectors.nextButtonCandidates);
  if (nextButton) {
    await nextButton.click?.();
  }

  const signButton = await findVisibleClickable(page, selectors.signatureButtonCandidates);
  if (!signButton) {
    throw new Error('MetaMask signature approval button was not visible; refusing to approve unknown prompt state.');
  }
  await signButton.click?.();
}

export function assertMetaMaskSignaturePromptText(promptText: string, input: WalletSignaturePromptInput): void {
  const normalizedText = promptText.toLowerCase();
  const unexpectedMarker = NON_SIGNATURE_PROMPT_MARKERS.find((marker) => normalizedText.includes(marker));
  if (unexpectedMarker) {
    throw new Error(`Unexpected MetaMask prompt marker "${unexpectedMarker}" while expecting a signature prompt; refusing to click.`);
  }
  const classification = classifyMetaMaskPromptText(promptText);
  if (classification.kind !== 'sign') {
    throw new Error('MetaMask notification page did not look like a signature prompt; refusing to click.');
  }

  if (input.signatureKind !== 'personal_sign' && input.signatureKind !== 'typed_data') {
    throw new Error('Expected signature kind is required before approving a MetaMask signature prompt.');
  }

  if (!input.expectedChainIdHex?.trim()) {
    throw new Error('Expected signature chain is required before approving a MetaMask signature prompt.');
  }

  const expectedOriginMarker = normalizeExpectedOriginMarker(input.origin);
  if (!expectedOriginMarker) {
    throw new Error('Expected dapp origin is required before approving a MetaMask signature prompt.');
  }
  if (!normalizedText.includes(expectedOriginMarker.toLowerCase())) {
    throw new Error(`Expected dapp origin ${expectedOriginMarker} was not found in MetaMask signature prompt; refusing to click.`);
  }

  if (!input.message?.trim()) {
    throw new Error('Expected signature message is required before approving a MetaMask signature prompt.');
  }
  if (!normalizedText.includes(input.message.toLowerCase())) {
    throw new Error('Expected signature message was not found in MetaMask signature prompt; refusing to click.');
  }

  if (input.signatureKind === 'personal_sign' && /typed\s*data|eth_signtypeddata/i.test(promptText)) {
    throw new Error('MetaMask prompt looked like typed data while expecting personal_sign; refusing to click.');
  }
  if (input.signatureKind === 'typed_data' && !/typed\s*data|eth_signtypeddata/i.test(promptText)) {
    throw new Error('MetaMask prompt did not include typed-data markers while expecting typed_data; refusing to click.');
  }
}

async function readPromptText(page: MetaMaskPromptPageLike, selector: string): Promise<string> {
  const text = await page.locator(selector).textContent?.();
  if (!text?.trim()) {
    throw new Error('MetaMask prompt text was empty; refusing to click unknown prompt state.');
  }
  return text;
}

async function findVisibleClickable(page: MetaMaskPromptPageLike, selectors: readonly string[]): Promise<MetaMaskPromptLocatorLike | undefined> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      if (!locator.click) {
        continue;
      }
      const visible = locator.isVisible ? await locator.isVisible() : true;
      if (visible) {
        return locator;
      }
    } catch {
      // Try the next selector candidate; fail closed only if none match.
    }
  }
  return undefined;
}

function mergePromptSelectors(selectors: Partial<MetaMaskPromptSelectors> | undefined): MetaMaskPromptSelectors {
  return {
    pageText: selectors?.pageText ?? DEFAULT_METAMASK_PROMPT_SELECTORS.pageText,
    nextButtonCandidates: selectors?.nextButtonCandidates ?? DEFAULT_METAMASK_PROMPT_SELECTORS.nextButtonCandidates,
    connectButtonCandidates: selectors?.connectButtonCandidates ?? DEFAULT_METAMASK_PROMPT_SELECTORS.connectButtonCandidates,
    signatureButtonCandidates: selectors?.signatureButtonCandidates ?? DEFAULT_METAMASK_PROMPT_SELECTORS.signatureButtonCandidates
  };
}

function normalizeExpectedOriginMarker(origin: string | undefined): string | undefined {
  const trimmed = origin?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return trimmed.split(/[?#]/, 1)[0];
  }
}
