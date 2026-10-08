import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const SAVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd()
$plain = [System.Text.Encoding]::UTF8.GetBytes($inputText)
try {
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $plain,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Console]::Out.Write([Convert]::ToBase64String($encrypted))
} finally {
  [Array]::Clear($plain, 0, $plain.Length)
}
`;
const LOAD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $data,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
  [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
} finally {
  [Array]::Clear($plain, 0, $plain.Length)
}
`;

export function localDataDirectory(): string {
  if (process.platform !== "win32") {
    throw new Error("ChatGPT MCP Tunnel supports Windows only.");
  }
  // Retain the user-local data directory to preserve encrypted keys across upgrades.
  return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "ObsidianMcpTunnel");
}

/** No user-supplied text is interpolated into executable PowerShell code. */
export async function runPowerShell(
  script: string,
  input = "",
  extraEnvironment: NodeJS.ProcessEnv = {},
  timeoutMs = 30_000,
): Promise<string> {
  if (process.platform !== "win32") throw new Error("Windows is required.");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const processHandle = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...extraEnvironment },
      },
    );
    let stdout = "";
    let stderrSize = 0;
    let finished = false;
    const timer = setTimeout(() => processHandle.kill(), timeoutMs);
    processHandle.stdout.setEncoding("utf8");
    processHandle.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 32_768) processHandle.kill();
    });
    processHandle.stderr.on("data", (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > 32_768) processHandle.kill();
    });
    processHandle.on("error", fail);
    processHandle.on("close", (code) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      if (code === 0) resolve(stdout.trim());
      else reject(new Error("Windows helper failed. Check permissions and retry."));
    });

    // Never pass secrets as command-line arguments or persist them in plugin data.json.
    processHandle.stdin.on("error", () => undefined);
    processHandle.stdin.end(input, "utf8");

    function fail(): void {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      reject(new Error("Unable to start Windows PowerShell."));
    }
  });
}

/**
 * Per-user DPAPI secrets, stored outside any Obsidian vault.
 * Secret values enter PowerShell over stdin and are never command arguments.
 */
export class WindowsSecretStore {
  private get runtimeKeyPath(): string {
    return join(localDataDirectory(), "runtime-key.dpapi");
  }

  private get mcpTokenPath(): string {
    return join(localDataDirectory(), "mcp-token.dpapi");
  }

  private async hasSecret(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new Error("Cannot access the encrypted credential.");
    }
  }

  private async saveSecret(path: string, value: string): Promise<void> {
    const encrypted = await runPowerShell(SAVE_SCRIPT, value);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) {
      throw new Error("Windows did not return an encrypted credential.");
    }
    await mkdir(localDataDirectory(), { recursive: true });
    await writeFile(path, encrypted, { mode: 0o600 });
  }

  private async readSecret(path: string): Promise<string> {
    const encrypted = await readFile(path, "utf8");
    const value = await runPowerShell(LOAD_SCRIPT, encrypted);
    if (!value) throw new Error("The encrypted credential is empty.");
    return value;
  }

  async hasKey(): Promise<boolean> {
    return this.hasSecret(this.runtimeKeyPath);
  }

  async saveKey(value: string): Promise<void> {
    if (value.length < 16 || value.length > 4096 || /[\r\n\0]/.test(value)) {
      throw new Error("Enter a valid runtime API key.");
    }
    await this.saveSecret(this.runtimeKeyPath, value);
  }

  async readKey(): Promise<string> {
    return this.readSecret(this.runtimeKeyPath);
  }

  async forgetKey(): Promise<void> {
    await rm(this.runtimeKeyPath, { force: true });
  }

  async hasMcpToken(): Promise<boolean> {
    return this.hasSecret(this.mcpTokenPath);
  }

  async saveMcpToken(value: string): Promise<void> {
    // A static MCP Authorization header is passed via the official client's
    // environment. Forbid whitespace, line breaks and comma separators.
    if (value.length < 8 || value.length > 4096 ||
      !/^[A-Za-z0-9._~+/\-]+={0,2}$/.test(value)) {
      throw new Error("Enter a valid bearer token without spaces.");
    }
    await this.saveSecret(this.mcpTokenPath, value);
  }

  async readMcpToken(): Promise<string> {
    return this.readSecret(this.mcpTokenPath);
  }

  async forgetMcpToken(): Promise<void> {
    await rm(this.mcpTokenPath, { force: true });
  }
}
