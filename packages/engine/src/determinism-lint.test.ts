import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function errorCount(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: repoRoot + filePath });
  return result?.errorCount ?? -1;
}

const engineFile = 'packages/engine/src/tmp.ts';

describe('engine determinism lint rule (SPEC 6.1)', () => {
  it.each([
    'export const x = Math.random();',
    'export const x = Math.sqrt(2);',
    'export const x = Math.sin(1);',
    "export const x = Math['random']();",
    'export const m = Math;',
    'export const x = Date.now();',
    'export const x = new Date();',
    'export const x = performance.now();',
    'export const x = setTimeout(() => 0, 1);',
    'export const x = setInterval(() => 0, 1);',
    'export const x = globalThis.Math.random();',
  ])('rejects %s', async (code) => {
    expect(await errorCount(code, engineFile)).toBeGreaterThan(0);
  });

  it.each([
    'export const x = Math.floor(3 / 2);',
    'export const x = Math.imul(2, 3);',
    'export const x = Math.max(1, 2);',
  ])('allows %s', async (code) => {
    expect(await errorCount(code, engineFile)).toBe(0);
  });

  it('also applies to engine test files', async () => {
    expect(
      await errorCount('export const x = Math.random();', 'packages/engine/src/a.test.ts'),
    ).toBeGreaterThan(0);
  });

  it('does not apply outside the engine', async () => {
    expect(await errorCount('export const x = Math.random();', 'tools/sim-cli/src/tmp.ts')).toBe(0);
  });
});
