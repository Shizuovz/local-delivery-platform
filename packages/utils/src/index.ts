export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function minorToMajor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}
