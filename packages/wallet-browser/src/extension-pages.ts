export interface ExtensionPageLike {
  url(): string;
  isClosed?(): boolean;
  bringToFront?(): Promise<void>;
}

export interface ExtensionBrowserContextLike<Page extends ExtensionPageLike = ExtensionPageLike> {
  pages(): readonly Page[];
  waitForEvent?(eventName: 'page', options?: { timeout?: number }): Promise<Page>;
  newPage?(): Promise<Page>;
}

export interface DiscoverMetaMaskExtensionPageOptions {
  extensionId?: string;
  preferredPath?: MetaMaskExtensionPagePath;
}

export interface WaitForMetaMaskExtensionPageOptions extends DiscoverMetaMaskExtensionPageOptions {
  timeoutMs?: number;
  ensureKeeperPage?: boolean;
}

export type MetaMaskExtensionPagePath = '/home.html' | '/notification.html';

const METAMASK_PAGE_PATHS = new Set<MetaMaskExtensionPagePath>(['/home.html', '/notification.html']);
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

export function isMetaMaskExtensionPageUrl(url: string, options: DiscoverMetaMaskExtensionPageOptions = {}): boolean {
  return getMetaMaskExtensionPagePath(url, options) !== undefined;
}

export function getMetaMaskExtensionPagePath(
  url: string,
  options: Pick<DiscoverMetaMaskExtensionPageOptions, 'extensionId'> = {}
): MetaMaskExtensionPagePath | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'chrome-extension:') {
    return undefined;
  }

  const extensionId = options.extensionId?.trim();
  if (extensionId && parsed.hostname !== extensionId) {
    return undefined;
  }

  return METAMASK_PAGE_PATHS.has(parsed.pathname as MetaMaskExtensionPagePath)
    ? (parsed.pathname as MetaMaskExtensionPagePath)
    : undefined;
}

export function discoverMetaMaskExtensionPage<Page extends ExtensionPageLike>(
  pages: readonly Page[],
  options: DiscoverMetaMaskExtensionPageOptions = {}
): Page {
  const candidates = collectMetaMaskExtensionPageCandidates(pages, options);

  if (candidates.length === 0) {
    throw new Error('No MetaMask extension page found. Expected one chrome-extension://<id>/home.html or notification.html page.');
  }

  if (options.preferredPath) {
    const preferred = candidates.filter((candidate) => candidate.path === options.preferredPath);
    if (preferred.length === 1) {
      return preferred[0].page;
    }
    if (preferred.length > 1) {
      throw new Error(`Multiple MetaMask extension page candidates found for preferred path ${options.preferredPath}; refusing to choose an ambiguous wallet UI page.`);
    }
  }

  if (candidates.length > 1) {
    throw new Error('Multiple MetaMask extension page candidates found; refusing to choose an ambiguous wallet UI page.');
  }

  return candidates[0].page;
}

export async function waitForMetaMaskExtensionPage<Page extends ExtensionPageLike>(
  context: ExtensionBrowserContextLike<Page>,
  options: WaitForMetaMaskExtensionPageOptions = {}
): Promise<Page> {
  const timeoutMs = validateTimeoutMs(options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  await ensureKeeperPageIfNeeded(context, options);

  const immediate = tryDiscoverMetaMaskExtensionPage(context.pages(), options);
  if (immediate) {
    await immediate.bringToFront?.();
    return immediate;
  }

  const deadline = Date.now() + timeoutMs;
  let lastError = 'No MetaMask extension page found.';

  while (Date.now() <= deadline) {
    if (context.waitForEvent) {
      const remaining = Math.max(1, deadline - Date.now());
      try {
        await context.waitForEvent('page', { timeout: remaining });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    const discovered = tryDiscoverMetaMaskExtensionPage(context.pages(), options);
    if (discovered) {
      await discovered.bringToFront?.();
      return discovered;
    }

    if (!context.waitForEvent) {
      break;
    }
  }

  throw new Error(`Timed out waiting for MetaMask extension page after ${timeoutMs}ms: ${lastError}`);
}

function collectMetaMaskExtensionPageCandidates<Page extends ExtensionPageLike>(
  pages: readonly Page[],
  options: DiscoverMetaMaskExtensionPageOptions
): Array<{ page: Page; path: MetaMaskExtensionPagePath }> {
  const candidates: Array<{ page: Page; path: MetaMaskExtensionPagePath }> = [];

  for (const page of pages) {
    if (isClosed(page)) {
      continue;
    }

    let url: string;
    try {
      url = page.url();
    } catch {
      continue;
    }

    const path = getMetaMaskExtensionPagePath(url, options);
    if (path) {
      candidates.push({ page, path });
    }
  }

  return candidates;
}

async function ensureKeeperPageIfNeeded<Page extends ExtensionPageLike>(
  context: ExtensionBrowserContextLike<Page>,
  options: WaitForMetaMaskExtensionPageOptions
): Promise<void> {
  if (!options.ensureKeeperPage || !context.newPage) {
    return;
  }

  const hasOpenNonExtensionPage = context.pages().some((page) => {
    if (isClosed(page)) {
      return false;
    }
    try {
      return !page.url().startsWith('chrome-extension://');
    } catch {
      return false;
    }
  });

  if (!hasOpenNonExtensionPage) {
    await context.newPage();
  }
}

function tryDiscoverMetaMaskExtensionPage<Page extends ExtensionPageLike>(
  pages: readonly Page[],
  options: DiscoverMetaMaskExtensionPageOptions
): Page | undefined {
  try {
    return discoverMetaMaskExtensionPage(pages, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('No MetaMask extension page found')) {
      return undefined;
    }
    throw error;
  }
}

function isClosed(page: ExtensionPageLike): boolean {
  try {
    return page.isClosed?.() ?? false;
  } catch {
    return true;
  }
}

function validateTimeoutMs(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('MetaMask extension page wait timeout must be a positive integer number of milliseconds.');
  }
  return timeoutMs;
}
