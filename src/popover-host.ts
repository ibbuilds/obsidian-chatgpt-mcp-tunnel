import type { ConnectionSnapshot, TunnelSettings } from "./types";
import type { SetupFacts } from "./ui-model";

/** Small, testable boundary between the UI and the local tunnel processes. */
export interface PopoverHost {
  readonly settings: TunnelSettings;
  readonly snapshot: ConnectionSnapshot;
  readonly installing: boolean;
  inspect(): Promise<SetupFacts>;
  findClient(): Promise<boolean>;
  installClient(progress: (message: string) => void): Promise<void>;
  chooseClient(document: Document): Promise<boolean>;
  saveAccount(tunnelId: string, key: string): Promise<void>;
  saveLocal(endpoint: string, token: string): Promise<void>;
  setAutoConnect(enabled: boolean): Promise<void>;
  acknowledgeChatgpt(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  forgetKey(): Promise<void>;
  forgetToken(): Promise<void>;
}
