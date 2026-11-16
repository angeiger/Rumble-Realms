/**
 * Formatting helpers for the German Markdown reports of `balance` and `tune`.
 * German number format (decimal comma); tables are padded so that `prettier --check` accepts them.
 */

/** 0.523 -> "52,3" (percent without the sign). */
export const pc = (x: number, digits = 1): string =>
  `${(100 * x).toFixed(digits)}`.replace('.', ',');

/** 1.25 -> "1,3" (one digit by default). */
export const num = (x: number, digits = 1): string => x.toFixed(digits).replace('.', ',');

/** Markdown table with padded columns, so that `prettier --check` accepts the file. */
export function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(3, ...all.map((r) => (r[c] ?? '').length)));
  const line = (cells: string[]): string =>
    `| ${cells.map((cell, c) => cell.padEnd(widths[c] as number)).join(' | ')} |`;
  const rule = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(header), rule, ...rows.map(line)].join('\n');
}
