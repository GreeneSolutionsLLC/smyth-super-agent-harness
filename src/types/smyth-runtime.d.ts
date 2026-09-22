export interface SmythRuntimeAPI {
  getEnv: () => Promise<Record<string, string>>;
  restartServers: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openLegal: (file: string) => Promise<void>;
  openSystemSettings: (permissionId: string) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  getUserDataPath: () => string;
  onServerStatus: (cb: (status: { smyth: boolean; omniroute: boolean }) => void) => void;
}

declare global {
  interface Window {
    smythRuntime?: SmythRuntimeAPI;
  }
}

export {};
