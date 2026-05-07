export {};

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
      on?(event: string, listener: (...args: unknown[]) => void): void;
    };
    __fixtureProviderRequests?: Array<{ method: string; params?: unknown[] | Record<string, unknown> }>;
  }
}
