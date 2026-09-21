import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'metro-resolver';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
function resolveWithMetro(platform: 'web' | 'ios') {
  return resolve({
    originModulePath: path.join(root, 'components/common/PlatformRoutingProbe.tsx'),
    sourceExts: ['tsx', 'ts', 'jsx', 'js'],
    assetExts: [],
    preferNativePlatform: true,
    nodeModulesPaths: [],
    extraNodeModules: {},
    mainFields: [],
    getPackageForModule: () => null,
    fileSystemLookup(filePath: string) {
      try {
        const stat = fs.statSync(filePath);
        return { exists: true, type: stat.isDirectory() ? 'd' : 'f', realPath: fs.realpathSync(filePath) };
      } catch {
        return { exists: false };
      }
    },
  } as any, './Tooltip', platform);
}

describe('Metro platform routing', () => {
  it('resolves the shared Tooltip import to the web and native implementations', () => {
    expect(resolveWithMetro('web')).toMatchObject({
      type: 'sourceFile',
      filePath: path.join(root, 'components/common/Tooltip.web.tsx'),
    });
    expect(resolveWithMetro('ios')).toMatchObject({
      type: 'sourceFile',
      filePath: path.join(root, 'components/common/Tooltip.tsx'),
    });
  });
});
