import assert from 'node:assert';
import fs from 'node:fs';

const source = fs.readFileSync('components/common/GlobalToastOverlay.web.tsx', 'utf8');
assert.match(source, /toast\.onPress &&/);
assert.match(source, /toast\.actionLabel \?\? 'View/);
assert.match(
  source,
  /toast\.onPress!\(\); onDismiss\(toast\.id\)/,
  'toast action must invoke its callback before dismissing the toast',
);
console.log('GlobalToastOverlay.web action check: ok');
