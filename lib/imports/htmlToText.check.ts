// Self-check for HTML → text — run: npx tsx lib/imports/htmlToText.check.ts
import assert from 'node:assert';
import { htmlToText } from './htmlToText';

// The reported bug: <p> wrappers left in the description.
assert.equal(htmlToText('<p>Prepare kitchen area</p>'), 'Prepare kitchen area');

// Multiple paragraphs → newline separated, no stray tags.
assert.equal(
  htmlToText('<p>First line</p><p>Second line</p>'),
  'First line\nSecond line',
);

// <br>, lists, entities.
assert.equal(htmlToText('Line one<br/>Line two'), 'Line one\nLine two');
assert.equal(htmlToText('<ul><li>a</li><li>b</li></ul>'), 'a\nb');
assert.equal(htmlToText('Tom &amp; Jerry &lt;tag&gt; &nbsp;done'), 'Tom & Jerry <tag>  done');
assert.equal(htmlToText("it&#39;s fine"), "it's fine");

// Edge cases.
assert.equal(htmlToText(''), '');
assert.equal(htmlToText('plain text'), 'plain text');
assert.equal(htmlToText('<p></p>'), '');

console.log('htmlToText: all assertions passed');
