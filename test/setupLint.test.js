'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ruleMatches, permissionProblems, skillProblems } = require('../scripts/setup-lint');

test('ruleMatches follows the Bash rule syntax: bare, exact, legacy prefix, wildcard', () => {
  assert.equal(ruleMatches('Bash', 'rm x'), true);
  assert.equal(ruleMatches('Bash(npm test)', 'npm test'), true);
  assert.equal(ruleMatches('Bash(npm test)', 'npm test x'), false);
  assert.equal(ruleMatches('Bash(npm run check:*)', 'npm run check:setup'), true);
  assert.equal(ruleMatches('Bash(git *)', 'git push origin main'), true);
  assert.equal(ruleMatches('Bash(git status *)', 'git push origin main'), false);
  assert.equal(ruleMatches('Read', 'rm x'), false);
});

test('permissionProblems flags allows that cover an ask-first action, not narrow ones', () => {
  const settings = { permissions: { allow: ['Bash(git add *)', 'Bash(npm run *)', 'Bash(git *)', 'Read'] } };
  const problems = permissionProblems('s.json', settings);
  assert.ok(problems.every((p) => p.includes('"Bash(git *)"')));
  assert.ok(problems.some((p) => p.includes('`git commit -m x`')));
});

test('skillProblems checks the name, the "Use when" and the description length', () => {
  const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# X`;
  assert.deepEqual(skillProblems('a', skill('a', 'Does x. Use when asked.')), []);
  assert.deepEqual(skillProblems('a', skill('b', 'Does x.')), [
    'a: frontmatter name "b" doesn\'t match its directory',
    'a: description has no "Use when"',
  ]);
  assert.match(skillProblems('a', skill('a', `Use when ${'x'.repeat(1100)}`))[0], /max 1024/);
  assert.deepEqual(skillProblems('a', '# no frontmatter'), ['a: SKILL.md has no frontmatter']);
});
