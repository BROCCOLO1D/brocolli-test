import { waitForMetaMaskExtensionPage, type ExtensionBrowserContextLike, type ExtensionPageLike } from './extension-pages.js';
import { type WalletConnectionPromptInput, type WalletPromptDriver } from './wallet-control.js';

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
}

export interface MetaMaskPromptDriverOptions {
  context: ExtensionBrowserContextLike;
  extensionId?: string;
  timeoutMs?: number;
  ensureKeeperPage?: boolean;
  selectors?: Partial<MetaMaskPromptSelectors>;
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
  const unexpectedMarker = NON_CONNECTION_PROMPT_MARKERS.find((marker) => normalizedText.includes(marker));
  if (unexpectedMarker) {
    throw new Error(`Unexpected MetaMask prompt marker "${unexpectedMarker}" while expecting a connection prompt; refusing to click.`);
  }

  if (!CONNECTION_PROMPT_MARKERS.some((marker) => normalizedText.includes(marker))) {
    throw new Error('MetaMask notification page did not look like a connection prompt; refusing to click.');
  }

  const expectedOriginMarker = normalizeExpectedOriginMarker(expectedOrigin);
  if (expectedOriginMarker && !normalizedText.includes(expectedOriginMarker.toLowerCase())) {
    throw new Error(`Expected dapp origin ${expectedOriginMarker} was not found in MetaMask connection prompt; refusing to click.`);
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
    connectButtonCandidates: selectors?.connectButtonCandidates ?? DEFAULT_METAMASK_PROMPT_SELECTORS.connectButtonCandidates
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
