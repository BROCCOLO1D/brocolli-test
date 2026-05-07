import {
  DEFAULT_SIGN_MESSAGE,
  buildPersonalSignParams,
  buildValueTransaction,
  formatAccount,
  formatChainId,
  getFixtureSelectors
} from './fixture.js';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const selectors = getFixtureSelectors();
let connectedAccount: string | undefined;
let currentChainId: string | undefined;

function query(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing fixture element for ${selector}`);
  }
  return element;
}

function setText(selector: string, value: string): void {
  query(selector).textContent = value;
}

function setStatus(message: string): void {
  setText(selectors.statusOutput, message);
}

function setEnabled(selector: string, enabled: boolean): void {
  const element = query(selector) as HTMLButtonElement;
  element.disabled = !enabled;
}

async function ethereumRequest<T>(method: string, params?: unknown[] | Record<string, unknown>): Promise<T> {
  if (!window.ethereum) {
    throw new Error('window.ethereum is not available');
  }
  return window.ethereum.request({ method, params }) as Promise<T>;
}

async function refreshWalletState(): Promise<void> {
  const [accounts, chainId] = await Promise.all([
    ethereumRequest<string[]>('eth_accounts'),
    ethereumRequest<string>('eth_chainId')
  ]);
  connectedAccount = accounts[0]?.toLowerCase();
  currentChainId = chainId;
  setText(selectors.connectedAccount, formatAccount(connectedAccount));
  setText(selectors.currentChain, formatChainId(currentChainId));
  setEnabled(selectors.signMessageButton, Boolean(connectedAccount));
  setEnabled(selectors.sendTransactionButton, Boolean(connectedAccount));
}

async function connectWallet(): Promise<void> {
  setStatus('Connecting wallet...');
  const accounts = await ethereumRequest<string[]>('eth_requestAccounts');
  connectedAccount = accounts[0]?.toLowerCase();
  currentChainId = await ethereumRequest<string>('eth_chainId');
  setText(selectors.connectedAccount, formatAccount(connectedAccount));
  setText(selectors.currentChain, formatChainId(currentChainId));
  setEnabled(selectors.signMessageButton, Boolean(connectedAccount));
  setEnabled(selectors.sendTransactionButton, Boolean(connectedAccount));
  setStatus(connectedAccount ? 'Wallet connected.' : 'No account returned by wallet.');
}

async function signMessage(): Promise<void> {
  if (!connectedAccount) {
    throw new Error('Connect wallet before signing');
  }
  setText(selectors.signMessageStatus, 'Awaiting signature...');
  const signature = await ethereumRequest<string>('personal_sign', buildPersonalSignParams(connectedAccount, DEFAULT_SIGN_MESSAGE));
  setText(selectors.signMessageStatus, `Signature received: ${signature.slice(0, 18)}...`);
  setStatus('Message signature request completed.');
}

async function sendTransaction(): Promise<void> {
  if (!connectedAccount) {
    throw new Error('Connect wallet before sending a transaction');
  }
  const chainId = currentChainId ?? (await ethereumRequest<string>('eth_chainId'));
  const tx = buildValueTransaction({ from: connectedAccount, chainId });
  setText(selectors.sendTransactionStatus, 'Awaiting transaction approval...');
  const hash = await ethereumRequest<string>('eth_sendTransaction', [tx]);
  setText(selectors.sendTransactionStatus, `Transaction sent: ${hash.slice(0, 18)}...`);
  setStatus('Transaction request completed.');
}

function bindAction(selector: string, action: () => Promise<void>, errorStatusSelector?: string): void {
  query(selector).addEventListener('click', () => {
    action().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const formatted = `Error: ${message}`;
      setStatus(formatted);
      if (errorStatusSelector) {
        setText(errorStatusSelector, formatted);
      }
    });
  });
}

function bindProviderEvents(): void {
  window.ethereum?.on?.('accountsChanged', (...args: unknown[]) => {
    const accounts = args[0] as string[] | undefined;
    connectedAccount = accounts?.[0]?.toLowerCase();
    setText(selectors.connectedAccount, formatAccount(connectedAccount));
    setEnabled(selectors.signMessageButton, Boolean(connectedAccount));
    setEnabled(selectors.sendTransactionButton, Boolean(connectedAccount));
  });
  window.ethereum?.on?.('chainChanged', (...args: unknown[]) => {
    currentChainId = args[0] as string | undefined;
    setText(selectors.currentChain, formatChainId(currentChainId));
  });
}

function main(): void {
  bindAction(selectors.connectButton, connectWallet);
  bindAction(selectors.signMessageButton, signMessage, selectors.signMessageStatus);
  bindAction(selectors.sendTransactionButton, sendTransaction, selectors.sendTransactionStatus);
  bindProviderEvents();
  setText(selectors.connectedAccount, formatAccount(undefined));
  setText(selectors.currentChain, formatChainId(undefined));
  setText(selectors.signMessageStatus, 'not requested');
  setText(selectors.sendTransactionStatus, 'not requested');
  setEnabled(selectors.signMessageButton, false);
  setEnabled(selectors.sendTransactionButton, false);
  setStatus(window.ethereum ? 'Wallet provider detected.' : 'No wallet provider detected.');
  if (window.ethereum) {
    refreshWalletState().catch(() => {
      // Initial read failures should not block explicit connect; surface provider availability only.
    });
  }
}

main();
