import { spawn } from "node:child_process";

// Opens `path` from a separate PowerShell process without delete sharing, the
// way antivirus scanners and indexers do, so renaming over it fails with EPERM
// until the handle is closed after `holdMs`. Resolves once the lock is held.
// With `rewriteTo`, the holder also replaces the file's content halfway through
// the hold, like an editor saving in place while it has the file open.
export async function holdWindowsFileLock(
  path: string,
  holdMs: number,
  rewriteTo?: string,
): Promise<{ released: Promise<void> }> {
  const quoted = path.replaceAll("'", "''");
  const half = String(Math.floor(holdMs / 2));
  const hold =
    rewriteTo === undefined
      ? `$f = [System.IO.File]::Open('${quoted}', 'Open', 'Read', 'Read'); ` +
        `[Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); ` +
        `Start-Sleep -Milliseconds ${String(holdMs)}; $f.Close()`
      : `$f = [System.IO.File]::Open('${quoted}', 'Open', 'ReadWrite', 'Read'); ` +
        `[Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); ` +
        `Start-Sleep -Milliseconds ${half}; $f.SetLength(0); ` +
        `$b = [System.Text.Encoding]::UTF8.GetBytes('${rewriteTo.replaceAll("'", "''")}'); ` +
        `$f.Write($b, 0, $b.Length); $f.Flush(); Start-Sleep -Milliseconds ${half}; $f.Close()`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", hold], {
    stdio: ["ignore", "pipe", "inherit"],
  });

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
