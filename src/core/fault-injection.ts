export function crashIfFaultPoint(point: string): void {
  if (process.env.SCALPEL_FAULT_POINT !== point) {
    return;
  }

  const exitCode = Number.parseInt(process.env.SCALPEL_FAULT_EXIT_CODE ?? "173", 10);
  process.stderr.write(`SCALPEL_FAULT_POINT ${point}\n`);
  process.exit(Number.isFinite(exitCode) ? exitCode : 173);
}
