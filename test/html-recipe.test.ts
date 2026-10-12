import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAppearsIn, createClaimsRegistry, type AppearsInVerdict } from '../src/index.js';
import { htmlToText } from './recipes/html-to-text.js';
import { NOW, claim } from './helpers.js';

// The README gives an htmlToText recipe for turning a page into text before
// checkAppearsIn. These rows run the exact code that README shows, so the
// recipe cannot drift from what is tested. Each row is a page and a claim; the
// verdict is what an adopter gets after htmlToText.

declare const process: { cpuUsage(): { user: number; system: number } };

function verdict(html: string, claimText: string): AppearsInVerdict {
  const registry = createClaimsRegistry();
  registry.registerClaim(claim({ id: 'c', text: claimText }));
  return checkAppearsIn(registry, htmlToText(html), ['c'], { maxAgeDays: 90, now: NOW }).results[0].verdict;
}

interface Row {
  name: string;
  html: string;
  claimText: string;
  expected: AppearsInVerdict;
}

const rows: Row[] = [
  { name: 'an apostrophe written as a numeric entity', html: '<p>Always confirm details on the provider&#x27;s site.</p>', claimText: "Always confirm details on the provider's site", expected: 'present' },
  { name: 'a decimal entity and a named entity', html: '<p>Pay&#39;s fee &amp; terms</p>', claimText: "Pay's fee & terms", expected: 'present' },
  { name: 'an escaped tag is text, not a tag', html: '<p>Type &lt;b&gt; for bold</p>', claimText: 'Type <b> for bold', expected: 'present' },
  { name: 'an unknown entity is left as written', html: '<p>Fish &chips; here</p>', claimText: 'Fish chips here', expected: 'missing' },
  { name: 'a double-encoded entity decodes once', html: '<p>&amp;lt;</p>', claimText: '&lt;', expected: 'present' },
  { name: 'adjacent inline elements do not glue words together', html: '<nav><a href="/a">Revenue layers</a><a href="/b">Never monetized</a></nav>', claimText: 'Never monetized', expected: 'present' },
  { name: 'table cells read as separate words', html: '<table><tr><td>SOC 2</td><td>Compliant</td></tr></table>', claimText: 'SOC 2 Compliant', expected: 'present' },
  { name: 'markup inside a sentence is flattened', html: '<p>Changes sync <strong>in real time</strong> across your team</p>', claimText: 'Changes sync in real time across your team', expected: 'present' },
  { name: 'a line break inside the sentence', html: '<p>Cancel<br>anytime</p>', claimText: 'Cancel anytime', expected: 'present' },
  { name: 'a ">" inside a quoted attribute does not end the tag early', html: '<a title="a > b" href="/x">Free for teams</a>', claimText: 'Free for teams', expected: 'present' },
  { name: 'a bare "<" is text', html: '<p>Under 5 users: 3 < 5 so free</p>', claimText: '3 < 5 so free', expected: 'present' },
  { name: 'only in a style="display:none" element', html: '<span style="color:red; display: none">Verify before you rely on it.</span>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in a visibility:hidden element', html: '<span style="visibility:hidden">Verify before you rely on it.</span>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in a hidden element', html: '<div hidden>Verify before you rely on it.</div>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in an aria-hidden="true" element', html: '<div aria-hidden="true">Verify before you rely on it.</div>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'aria-hidden="false" is shown', html: '<div aria-hidden="false">Verify before you rely on it.</div>', claimText: 'Verify before you rely on it', expected: 'present' },
  { name: 'only in a template', html: '<template><p>Verify before you rely on it.</p></template>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in a script', html: '<script>var s = "Verify before you rely on it.";</script>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in a style block', html: '<style>/* Verify before you rely on it. */</style>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in a noscript block', html: '<noscript>Verify before you rely on it.</noscript>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in the head', html: '<head><title>Verify before you rely on it.</title></head><body>Hi</body>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'only in an HTML comment', html: '<!-- Verify before you rely on it. --><p>Hi</p>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'a hidden wrapper hides everything nested in it', html: '<div hidden><div><p>Deep</p></div><span>Verify before you rely on it.</span></div>', claimText: 'Verify before you rely on it', expected: 'missing' },
  { name: 'text after a hidden element closes is shown again', html: '<div hidden><p>x</p></div><p>Free for teams</p>', claimText: 'Free for teams', expected: 'present' },
  { name: 'void elements inside a hidden element do not end it early', html: '<div aria-hidden="true"><br><img src="a.png" alt="x"><input type="text">Verify first</div>', claimText: 'Verify first', expected: 'missing' },
  { name: 'a shown copy next to a hidden copy still counts', html: '<span hidden>Free for teams</span><p>Free for teams</p>', claimText: 'Free for teams', expected: 'present' },
  { name: 'tags in upper case and mixed case', html: '<DIV HIDDEN>Verify first</DIV><P>Free for teams</P>', claimText: 'Verify first', expected: 'missing' },
  { name: 'an unquoted attribute value', html: '<div aria-hidden=true>Verify first</div>', claimText: 'Verify first', expected: 'missing' },
  { name: 'a stray close tag is ignored', html: '</b></i><p>Free for teams</p>', claimText: 'Free for teams', expected: 'present' },
  { name: 'a script with a closing-tag look-alike in a string', html: '<script>var a = "</scripts>"; </script><p>Free for teams</p>', claimText: 'Free for teams', expected: 'present' },
  { name: 'an unterminated comment drops the rest', html: '<p>Free</p><!-- Free for teams', claimText: 'Free for teams', expected: 'missing' },
  { name: 'an unterminated tag drops the rest', html: '<p>Free</p><a href="x', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: a script closes only at </script>, not at </scripts>', html: '<script>const s = "</scripts>Free for teams";</script>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: a slash on a non-void hidden element is ignored, as in a browser', html: '<div hidden/>Free for teams</div>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: a slash on a script is ignored, as in a browser', html: '<script/>"Free for teams"</script>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: an entity in a style attribute is decoded before the check', html: '<div style="display&#58;none">Free for teams</div>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: an entity in aria-hidden is decoded before the check', html: '<div aria-hidden="&#116;rue">Free for teams</div>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: entity names that are object properties stay as written', html: '<p>&constructor; &toString; &__proto__; &hasOwnProperty;</p>', claimText: '&constructor; &toString; &__proto__; &hasOwnProperty;', expected: 'present' },
  { name: 'LIMIT: a hidden self-closing svg is read as open and hides the rest of its parent', html: '<div><svg style="display:none" /><p>Free for teams</p></div>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: a hidden element with a slash stays hidden inside foreignObject', html: '<svg><foreignObject><div hidden/>Free for teams</div></foreignObject></svg>', claimText: 'Free for teams', expected: 'missing' },
  { name: 'review: a slash that ends an unquoted attribute value is not a self-close', html: '<svg style="display:none" data-x=x/>Free for teams</svg>', claimText: 'Free for teams', expected: 'missing' },
  // Limits the README names. These pin what the recipe does NOT do.
  { name: 'LIMIT: a CSS class such as "hidden" is not evaluated', html: '<span class="hidden text-xs">Verify before you rely on it.</span>', claimText: 'Verify before you rely on it', expected: 'present' },
  { name: 'LIMIT: negation is still the same words', html: '<p>We are not SOC 2 compliant</p>', claimText: 'SOC 2 compliant', expected: 'present' },
  { name: 'LIMIT: a paraphrase is a different wording', html: '<p>Includes 1M events and 5k replays per month</p>', claimText: 'Includes 1 million events and 5,000 web replays each month', expected: 'missing' },
  { name: 'LIMIT: a price is matched literally', html: '<p>Pro is $25.00 a month</p>', claimText: '$25 a month', expected: 'missing' },
];

describe('htmlToText recipe: verdict table', () => {
  for (const row of rows) {
    it(row.name, () => {
      expect(verdict(row.html, row.claimText)).toBe(row.expected);
    });
  }
});

describe('htmlToText recipe: output', () => {
  it('returns an empty string for an empty page', () => {
    expect(htmlToText('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(htmlToText('just words')).toBe('just words');
  });
});

function cpuMs<T>(fn: () => T): { value: T; ms: number } {
  const before = process.cpuUsage();
  const value = fn();
  const after = process.cpuUsage();
  return { value, ms: (after.user - before.user + (after.system - before.system)) / 1000 };
}

describe('htmlToText recipe: stays linear on hostile pages', () => {
  const shapes: [string, (n: number) => string][] = [
    ['unclosed <a> then stray </b>', (n) => `${'<a>'.repeat(n)}${'</b>'.repeat(n)}x`],
    ['deep nesting then one close for each', (n) => `${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`],
    ['many bare "<"', (n) => '<'.repeat(n)],
    ['many unterminated "<!"', (n) => '<!'.repeat(n)],
    ['many comment openers with no end', (n) => '<!--'.repeat(n)],
    ['many script openers with no end', (n) => '<script>'.repeat(n)],
    ['many "</" inside a script', (n) => `<script>${'</'.repeat(n)}`],
    ['many hidden attributes', (n) => `<div ${'hidden '.repeat(n)}>x</div>`],
    ['a long style value', (n) => `<div style="${'display '.repeat(n)}">x</div>`],
    ['many entity openers', (n) => '&#'.repeat(n)],
  ];
  for (const [name, make] of shapes) {
    it(name, () => {
      htmlToText(make(2000)); // warm up
      const small = cpuMs(() => htmlToText(make(25_000)));
      const large = cpuMs(() => htmlToText(make(200_000)));
      // 8x the input; a quadratic shape would be 64x. Allow noise.
      expect(large.ms).toBeLessThan(Math.max(small.ms, 5) * 24);
      expect(large.ms).toBeLessThan(3000);
    });
  }
});

describe('htmlToText recipe: README', () => {
  it('shows exactly the code that is tested', () => {
    const readme = readFileSync('README.md', 'utf8');
    const marker = '<!-- recipe: test/recipes/html-to-text.ts -->\n```ts\n';
    const start = readme.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const bodyStart = start + marker.length;
    const end = readme.indexOf('\n```', bodyStart);
    expect(readme.slice(bodyStart, end + 1)).toBe(readFileSync('test/recipes/html-to-text.ts', 'utf8'));
  });
});
