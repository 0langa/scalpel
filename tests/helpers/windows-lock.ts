import { spawn } from "node:child_process";

// Opens `path` from a separate PowerShell process without delete sharing, the
// way antivirus scanners and indexers do, so renaming over it fails with EPERM
// until the handle is closed after `holdMs`. Resolves once the lock is held.
export async function holdWindowsFileLock(
  path: string,
  holdMs: number,
): Promise<{ released: Promise<void> }> {
  const quoted = path.replaceAll("'", "''");
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$f = [System.IO.File]::Open('${quoted}', 'Open', 'Read', 'Read'); ` +
        `[Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); ` +
        `Start-Sleep -Milliseconds ${String(holdMs)}; $f.Close()`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  const released = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", () => {
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.stdout.on("data", (data: Buffer) => {
      if (data.toString("utf8").includes("locked")) {
        resolve();
      }
    });
    child.on("exit", (code) => {
      reject(new Error(`lock helper exited early with code ${String(code)}`));
    });
  });

  return { released };
}
