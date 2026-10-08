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
    throw new Error("MCP Tunnel currently supports Windows only.");
  }
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

export class WindowsSecretStore {
  private get filePath(): string {
    return join(localDataDirectory(), "runtime-key.dpapi");
  }

  async hasKey(): Promise<boolean> {
    try {
      await readFile(this.filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new Error("Cannot access the encrypted credential.");
    }
  }

  async saveKey(value: string): Promise<void> {
    if (
      value.length < 16 ||
      value.length > 4096 ||
      /[\r\n\0]/.test(value)
    ) {
      throw new Error("Enter a valid runtime API key.");
    }
    const encrypted = await runPowerShell(SAVE_SCRIPT, value);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) {
      throw new Error("Windows did not return an encrypted credential.");
    }
    await mkdir(localDataDirectory(), { recursive: true });
    await writeFile(this.filePath, encrypted, { mode: 0o600 });
  }

  async readKey(): Promise<string> {
    const encrypted = await readFile(this.filePath, "utf8");
    const value = await runPowerShell(LOAD_SCRIPT, encrypted);
    if (!value) throw new Error("The encrypted credential is empty.");
    return value;
  }

  async forgetKey(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
