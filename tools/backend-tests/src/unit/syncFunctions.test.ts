/**
 * The copy of the shared code in supabase/functions/_shared (D-083, tools/sync-functions.mjs).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compare, reachableFiles, sync, TARGET } from '../../../sync-functions.mjs';

describe('the copy in the repository', () => {
  it('is up to date (else: pnpm sync:functions)', () => {
    const { missing, changed, extra } = compare();
    expect({ missing, changed, extra }).toEqual({ missing: [], changed: [], extra: [] });
  });

  it('contains the shared code and the engine, but no tests or test helpers', () => {
    const files = reachableFiles();
    expect(files).toContain('packages/shared/src/index.ts');
    expect(files).toContain('packages/shared/src/server/handlers.ts');
    expect(files).toContain('packages/engine/src/index.ts');
    expect(files.filter((f) => /\.test\.ts$|testing\.ts$|\.json$/.test(f))).toEqual([]);
  });
});

describe('sync-functions on a small fixture', () => {
  let root = '';

  function put(path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  function fixture(): void {
    root = mkdtempSync(join(tmpdir(), 'rr-sync-'));
    put(
      'packages/shared/src/index.ts',
      "export * from './a.ts';\nimport type { E } from '../../engine/src/index.ts';\n",
    );
    put('packages/shared/src/a.ts', "export { b } from './sub/b.ts';\nexport const a = 1;\n");
    put('packages/shared/src/sub/b.ts', 'export const b = 2;\n');
    put('packages/shared/src/a.test.ts', "import { a } from './a.ts';\n");
    put('packages/shared/src/unused.ts', 'export const unused = 3;\n');
    put('packages/engine/src/index.ts', 'export type E = number;\n');
    put('packages/engine/src/golden/replay.json', '{}\n');
  }

  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('follows the relative imports from packages/shared/src/index.ts', () => {
    fixture();
    expect(reachableFiles(root)).toEqual([
      'packages/engine/src/index.ts',
      'packages/shared/src/a.ts',
      'packages/shared/src/index.ts',
      'packages/shared/src/sub/b.ts',
    ]);
  });

  it('writes byte-identical copies plus a README and reports every difference', () => {
    fixture();
    expect(compare(root).missing).toHaveLength(5);
    expect(sync(root)).toEqual({ files: 5, added: 5, updated: 0, removed: 0 });
    const copy = join(root, TARGET, 'packages/shared/src/a.ts');
    expect(readFileSync(copy)).toEqual(readFileSync(join(root, 'packages/shared/src/a.ts')));
    expect(readFileSync(join(root, TARGET, 'README.md'), 'utf8')).toMatch(/pnpm sync:functions/);
    expect(compare(root)).toMatchObject({ missing: [], changed: [], extra: [] });

    writeFileSync(copy, 'export const a = 99;\n');
    put(`${TARGET}/packages/shared/src/old.ts`, 'stale\n');
    rmSync(join(root, TARGET, 'packages/shared/src/sub/b.ts'));
    expect(compare(root)).toMatchObject({
      missing: [`${TARGET}/packages/shared/src/sub/b.ts`],
      changed: [`${TARGET}/packages/shared/src/a.ts`],
      extra: [`${TARGET}/packages/shared/src/old.ts`],
    });

    expect(sync(root)).toEqual({ files: 5, added: 1, updated: 1, removed: 1 });
    expect(compare(root)).toMatchObject({ missing: [], changed: [], extra: [] });
  });

  it('rejects package imports and imports of missing or outside files', () => {
    fixture();
    put('packages/shared/src/index.ts', "import { x } from 'zod';\n");
    expect(() => reachableFiles(root)).toThrow(/only use relative imports/);
    put('packages/shared/src/index.ts', "import { x } from './missing.ts';\n");
    expect(() => reachableFiles(root)).toThrow(/does not exist/);
    put('packages/web/src/x.ts', 'export const x = 1;\n');
    put('packages/shared/src/index.ts', "import { x } from '../../web/src/x.ts';\n");
    expect(() => reachableFiles(root)).toThrow(/outside/);
    put('packages/shared/src/index.ts', "import { a } from './a.test.ts';\n");
    expect(() => reachableFiles(root)).toThrow(/test file/);
  });
});
