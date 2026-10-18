'use strict';

// Lists media-query rules in the app's stylesheets that a later top-level rule of the same layer
// and selector overrides, in any file: equal specificity, so source order wins and the media rule
// silently never applies (U84 on phone, the desktop app bar's search width). Run by `npm run check`.

const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

// The sheets in cascade order: public/style.css's @imports, then its own rules.
function loadSheets() {
  const entry = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  const imports = [...entry.matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => m[1]);
  return [
    ...imports.map((file) => ({ file, css: fs.readFileSync(path.join(PUBLIC, file), 'utf8') })),
    { file: 'style.css', css: entry },
  ];
}

// Every rule as { selectors, media, layer, line, props }, from a brace scan: the sheets have no
// strings or comments containing braces, which is all this relies on.
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
      const media = stack.findLast((b) => b.prelude.startsWith('@media'))?.prelude ?? null;
      const layer = stack.findLast((b) => b.prelude.startsWith('@layer'))?.prelude ?? null;
      if (!prelude.startsWith('@')) {
        const body = css.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, '');
        rules.push({
          selectors: prelude.split(',').map((s) => s.trim()),
          media,
          layer,
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

// `sheets`: [{ file, css }] in cascade order.
function findOverrides(sheets) {
  const rules = sheets.flatMap(({ file, css }, order) => parseRules(css).map((r) => ({ ...r, file, order })));
  const after = (a, b) => a.order > b.order || (a.order === b.order && a.line > b.line);
  const topLevel = rules.filter((r) => r.media === null);
  const problems = [];
  for (const rule of rules) {
    if (rule.media === null) continue;
    for (const selector of rule.selectors) {
      for (const later of topLevel) {
        // Another layer's rule wins or loses by layer order, not source order.
        if (later.layer !== rule.layer || !after(later, rule) || !later.selectors.includes(selector)) continue;
        const lost = [...rule.props].filter((p) => later.props.has(p));
        if (lost.length)
          problems.push(
            `${rule.file}:${rule.line} ${selector} (${rule.media}) is overridden by ${later.file}:${later.line}: ${lost.join(', ')}`,
          );
      }
    }
  }
  return problems;
}

if (require.main === module) {
  const problems = findOverrides(loadSheets());
  if (problems.length) {
    console.error(
      `Media-query rules overridden by a later rule (move them after it):\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exitCode = 1;
  }
}

module.exports = { findOverrides };
