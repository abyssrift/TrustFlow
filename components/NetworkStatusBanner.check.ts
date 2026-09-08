import assert from 'node:assert';
import fs from 'node:fs';

const source = fs.readFileSync('components/NetworkStatusBanner.tsx', 'utf8');
const webSource = fs.readFileSync('components/NetworkStatusBanner.web.tsx', 'utf8');
assert.match(source, /useNetInfo/);
assert.doesNotMatch(webSource, /@react-native-community\/netinfo/);
assert.doesNotMatch(webSource, /useNetInfo/);
assert.match(webSource, /useWebConnectionInfo/);
assert.doesNotMatch(source, /supabaseUrl|AbortController|probeReachability|Platform\.OS === 'web'/);
assert.match(webSource, /let probeInFlight = false/);
assert.match(webSource, /if \(cancelled \|\| probeInFlight\) return/);
assert.match(webSource, /controller\.abort\(reason\)/);
assert.match(webSource, /reason\.name = 'AbortError'/);
assert.match(webSource, /finally \{[\s\S]*?clearTimeout\(timeout\)/);
assert.match(webSource, /activeController\)/);
assert.match(webSource, /if \(cancelled\) return/);
assert.match(webSource, /reachable: false/);
console.log('NetworkStatusBanner probe check: ok');
