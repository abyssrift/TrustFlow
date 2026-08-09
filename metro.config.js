// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// graphify-out/ (20+ dated knowledge-graph snapshots) and website/ (a separate
// static site) have no JS Metro needs to bundle, but sit in the project root
// and get crawled by the file watcher anyway — on this repo that crawl is
// slow enough to blow metro-file-map's watch-mode startup timeout entirely
// ("Failed to start watch mode"). Block them so the watcher only walks
// actual source.
//
// `.claude/` is the big one and the reason this list was not enough on its
// own: it holds ~36 git worktrees, most carrying their own node_modules, so
// it dwarfs everything else here. Enumerating it takes MINUTES — a plain
// recursive file count over it was killed at the 5-minute mark — while
// metro-file-map's watch-mode timeout is a few seconds. It is also not
// source: nothing under it is ever imported by this app.
//
// The failure is confusing because the timeout surfaces as a crash somewhere
// else entirely. The watcher gives up, the file map is left undefined, and
// react-native-css-interop's metro patch then dereferences it:
//     TypeError: Cannot read properties of undefined (reading 'getSha1')
// That is the symptom, not the cause. Do not go debugging css-interop.
config.resolver.blockList = [
  ...config.resolver.blockList,
  /graphify-out[\\/].*/,
  /(^|[\\/])\.git[\\/].*/,
  /(^|[\\/])website[\\/].*/,
  /(^|[\\/])\.claude[\\/].*/,
];

module.exports = withNativeWind(config, { input: './global.css' });
