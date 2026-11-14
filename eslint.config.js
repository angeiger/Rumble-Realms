import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const ALLOWED_MATH = ['abs', 'min', 'max', 'sign', 'trunc', 'floor', 'ceil', 'imul', 'clz32'];
const WHY = 'Engine must be deterministic across devices (SPEC 6.1).';

/**
 * Determinism rules for packages/engine (D-005, SPEC 6.1): allow-list for Math.*,
 * plus forbidden globals. Also applies to the engine's test files.
 */
export const engineDeterminismConfig = {
  files: ['packages/engine/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `MemberExpression[computed=false][object.name='Math']:not([property.name=/^(${ALLOWED_MATH.join('|')})$/])`,
        message: `Math.* is allow-listed (${ALLOWED_MATH.join(', ')}); other functions may differ in the last digit per device. ${WHY}`,
      },
      {
        selector: `MemberExpression[computed=true][object.name='Math']`,
        message: `Computed access Math[...] is not allowed; use an allow-listed Math.<name>. ${WHY}`,
      },
      {
        selector: `Identifier[name='Math']:not(MemberExpression > Identifier.object)`,
        message: `Math must not be used as a bare value; call allow-listed Math.<name> directly. ${WHY}`,
      },
    ],
    'no-restricted-globals': [
      'error',
      ...['Date', 'performance', 'setTimeout', 'setInterval', 'globalThis'].map((name) => ({
        name,
        message: `${name} is non-deterministic or time-dependent; the engine counts in ticks. ${WHY}`,
      })),
    ],
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/dev-dist/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  engineDeterminismConfig,
  // Package B (apps/web): add blocks here, after the engine rules, e.g. React plugin rules
  // and browser globals (`globals.browser`) scoped to `apps/web/**`. Node globals for
  // tools/*: scope `globals.node` to `tools/**`. Never extend the engine block's files.
);
