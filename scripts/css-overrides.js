'use strict';

// Lists rules in public/style.css's narrow-screen media queries (`max-width`/`max-height`) that a
// later top-level rule with the same selector overrides: equal specificity, so source order wins
// and the phone rule silently never applies (U84). Run by `npm run check`.

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'public', 'style.css');

// Every rule as { selectors, media, line, props }, from a brace scan: style.css has no strings or
// comments containing braces, which is all this relies on.
function parseRules(css) {
  const rules = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== '{' && c !== '}') continue;
    if (c === '{') {
      const prelude = css
        .slice(start, i)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      stack.push({ prelude, open: i });
    } else {
      const { prelude, open } = stack.pop();
      const parent = stack.at(-1)?.prelude ?? null;
      if (!prelude.startsWith('@')) {
        const body = css.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, '');
        rules.push({
          selectors: prelude.split(',').map((s) => s.trim()),
          media: parent,
          line: css.slice(0, open).split('\n').length,
          props: new Set(
            body
              .split(';')
              .filter((d) => d.includes(':'))
              .map((d) => d.split(':')[0].trim()),
          ),
        });
      }
    }
    start = i + 1;
  }
  return rules;
}

const rules = parseRules(fs.readFileSync(FILE, 'utf8'));
const topLevel = rules.filter((r) => r.media === null);
const problems = [];
for (const rule of rules) {
  if (!/^@media\b.*\bmax-(width|height)\b/.test(rule.media ?? '')) continue;
  for (const selector of rule.selectors) {
    for (const later of topLevel) {
      if (later.line <= rule.line || !later.selectors.includes(selector)) continue;
      const lost = [...rule.props].filter((p) => later.props.has(p));
      if (lost.length)
        problems.push(
          `style.css:${rule.line} ${selector} (${rule.media}) is overridden by line ${later.line}: ${lost.join(', ')}`,
        );
    }
  }
}

if (problems.length) {
  console.error(
    `Narrow-screen rules overridden by a later rule (move them after it):\n${problems.map((p) => `  ${p}`).join('\n')}`,
  );
  process.exitCode = 1;
}
