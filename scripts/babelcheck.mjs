#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
let failed = false;
for (const file of process.argv.slice(2)) {
  try {
    babel.transformSync(readFileSync(file, 'utf8'), {
      filename: file, cwd: process.cwd(), root: process.cwd(),
      caller: { name: 'metro', bundler: 'metro', platform: 'web', isDev: true, supportsStaticESM: false },
    });
    console.log(`OK   ${file}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${file}\n     ${String(error.message).split('\n')[0]}`);
  }
}
process.exit(failed ? 1 : 0);
