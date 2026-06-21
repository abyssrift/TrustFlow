// Native: Metro turns dynamic `import()` into an async require-by-module-id,
// which is fragile and throws "Requiring unknown module …" after a cache
// invalidation. A synchronous require is always statically bundled and resolves
// reliably (there is no bundle-size win from lazy-loading on native anyway).
export function loadXlsx(): Promise<typeof import('xlsx')> {
  return Promise.resolve(require('xlsx'));
}
