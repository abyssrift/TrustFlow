// Web: lazy dynamic import keeps the heavy xlsx library out of the main bundle
// (proper code-splitting). The native counterpart lives in loadXlsx.native.ts.
export function loadXlsx(): Promise<typeof import('xlsx')> {
  return import('xlsx');
}
