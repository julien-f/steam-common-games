'use strict';

// Facts for the setup-review skill.
//   node scripts/setup-facts.js                    each script's callers (tests and the changelog excluded —
//                                                  a script only they mention has no caller), and which read
//                                                  arguments without printing a usage line
//   node scripts/setup-facts.js --cost             time and output size of the gates an agent runs
//   node scripts/setup-facts.js --transcripts[=N]  the last N (default 20) sessions' largest outputs, slowest
//                                                  calls, repeated command pairs, denied and rejected calls; commands are
//                                                  reduced to their first words, so no arguments (or secrets) print
//   node scripts/setup-facts.js --agents[=ID]      per subagent of session ID (default: the newest with any):
//                                                  time, turns, cache reads, failed calls, time in tests/e2e/commits

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const COST_SCRIPTS = ['check', 'test', 'test:e2e', 'build'];
const TOP = 10;

// `files`: [relPath, text] pairs; a script is called as `scripts/<name>(.js)` or `./<name>(.js)`.
function callers(name, files) {
  const ref = new RegExp(`(?:scripts/|\\./)${name}(?:\\.js)?(?![\\w-])`);
  return files
    .filter(([file, text]) => file !== `scripts/${name}.js` && !file.startsWith('test/') && ref.test(text))
    .map(([file]) => file);
}

function argsWithoutUsage(source) {
  return source.includes('process.argv') && !source.includes('Usage');
}

// `cd x && FOO=1 npm run test:one a.js | tail` → `npm run test:one`.
function commandKey(command) {
  const segment =
    command
      .split(/&&|\|\||[|;\n]/)
      .map((s) => s.trim())
      .find((s) => s && !/^cd\s/.test(s)) ?? '';
  // Env assignments, and the options naming a directory (`git -C <dir>`, `npm --prefix <dir>`), say nothing.
  const words = segment
    .split(/\s+/)
    .filter((w) => !/^\w+=/.test(w))
    .filter((w, i, all) => !['-C', '--prefix'].includes(w) && !['-C', '--prefix'].includes(all[i - 1]));
  const [cmd, sub, third] = words;
  if (!['npm', 'npx', 'git', 'node', 'gh'].includes(cmd)) return cmd ?? '';
  return [cmd, sub, sub === 'run' ? third : undefined].filter(Boolean).join(' ');
}

const text = (content) => (typeof content === 'string' ? content : (content ?? []).map((c) => c.text ?? '').join(''));

// One session's JSONL lines → its tool calls, in order: `{ key, bytes, ms, error, denied, rejected }`.
function parseSession(lines) {
  const calls = new Map();
  for (const line of lines) {
    const entry = JSON.parse(line);
    for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {
      if (part.type === 'tool_use') {
        const key = part.name === 'Bash' ? commandKey(part.input.command ?? '') : part.name;
        calls.set(part.id, { key, start: Date.parse(entry.timestamp) });
      } else if (part.type === 'tool_result' && calls.has(part.tool_use_id)) {
        const call = calls.get(part.tool_use_id);
        const out = text(part.content);
        Object.assign(call, {
          bytes: out.length,
          ms: Date.parse(entry.timestamp) - call.start,
          error: Boolean(part.is_error),
          denied: Boolean(part.is_error) && /^Permission for this action was denied/.test(out),
          rejected: Boolean(part.is_error) && /^The user doesn't want to proceed/.test(out),
        });
      }
    }
  }
  return [...calls.values()].filter((c) => c.bytes !== undefined).map(({ start, ...c }) => c);
}

// A user turn that is a prompt, not a tool result, a slash command's echo or a loaded skill's text.
function isPrompt(entry) {
  if (entry.type !== 'user' || entry.isMeta) return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return !/^\s*<(command|local-command)-/.test(content);
  return (
    Array.isArray(content) &&
    content.every((c) => c.type === 'text') &&
    !content.some((c) => c.text.startsWith('Base directory for this skill'))
  );
}

// One session's JSONL lines → each run of a skill in `names`, by `/name` or the Skill tool:
// `{ skill, ms }`, ms running to the next prompt (or the session's end).
function skillRuns(lines, names) {
  const entries = lines.map((line) => JSON.parse(line));
  const runs = [];
  entries.forEach((entry, i) => {
    const content = entry.message?.content;
    const skill =
      typeof content === 'string'
        ? content.match(/<command-name>\/([\w:-]+)<\/command-name>/)?.[1]
        : (Array.isArray(content) ? content : []).find((c) => c.type === 'tool_use' && c.name === 'Skill')?.input
            ?.skill;
    if (!names.includes(skill)) return;
    const end = entries.slice(i + 1).find(isPrompt) ?? entries.findLast((e) => e.timestamp);
    runs.push({ skill, ms: Date.parse(end.timestamp) - Date.parse(entry.timestamp) });
  });
  return runs;
}

// `sessions`: arrays of parseSession's calls.
function summarize(sessions) {
  const byKey = new Map();
  const pairs = new Map();
  sessions.forEach((calls, session) => {
    calls.forEach((call, i) => {
      const s = byKey.get(call.key) ?? {
        key: call.key,
        count: 0,
        bytes: 0,
        maxBytes: 0,
        maxMs: 0,
        denied: 0,
        rejected: 0,
      };
      s.count++;
      s.bytes += call.bytes;
      s.maxBytes = Math.max(s.maxBytes, call.bytes);
      s.maxMs = Math.max(s.maxMs, call.ms);
      s.denied += call.denied ? 1 : 0;
      s.rejected += call.rejected ? 1 : 0;
      byKey.set(call.key, s);
      const next = calls[i + 1];
      if (next && next.key !== call.key) {
        const pair = `${call.key} → ${next.key}`;
        const p = pairs.get(pair) ?? { pair, count: 0, sessions: new Set() };
        p.count++;
        p.sessions.add(session);
        pairs.set(pair, p);
      }
    });
  });
  const keys = [...byKey.values()];
  const top = (list, by) => [...list].sort((a, b) => by(b) - by(a)).slice(0, TOP);
  return {
    output: top(keys, (k) => k.bytes),
    slow: top(
      keys.filter((k) => k.key !== 'AskUserQuestion'), // its time is the user's answer
      (k) => k.maxMs,
    ),
    pairs: top(
      [...pairs.values()].filter((p) => p.sessions.size >= 2),
      (p) => p.sessions.size * 1000 + p.count,
    ).map((p) => ({ pair: p.pair, count: p.count, sessions: p.sessions.size })),
    denied: keys
      .filter((k) => k.denied || k.rejected)
      .map((k) => ({ key: k.key, denied: k.denied, rejected: k.rejected })),
  };
}

// Commands whose time is the gates' (tests, e2e, commit hooks), not the agent's thinking.
const GATE = /^(npm test|npm run test(:one|:e2e)?|node scripts\/e2e\.js|git commit)$/;

// One subagent's JSONL lines → `{ minutes, turns, cacheRead, calls, errors, gateSec }`. A response
// spans several lines, each repeating its usage so far, so each field's max per message id counts.
function agentSummary(lines) {
  const entries = lines.map((line) => JSON.parse(line));
  const stamps = entries.filter((e) => e.timestamp).map((e) => Date.parse(e.timestamp));
  const cache = new Map();
  for (const e of entries)
    if (e.type === 'assistant' && e.message?.id)
      cache.set(e.message.id, Math.max(cache.get(e.message.id) ?? 0, e.message.usage?.cache_read_input_tokens ?? 0));
  const calls = parseSession(lines);
  return {
    minutes: stamps.length ? (Math.max(...stamps) - Math.min(...stamps)) / 60000 : 0,
    turns: cache.size,
    cacheRead: [...cache.values()].reduce((a, b) => a + b, 0),
    calls: calls.length,
    errors: calls.filter((c) => c.error).length,
    gateSec: calls.filter((c) => GATE.test(c.key)).reduce((s, c) => s + c.ms, 0) / 1000,
  };
}

function agents(sessionId) {
  const dir = path.join(os.homedir(), '.claude', 'projects', ROOT.replace(/[^\w]/g, '-'));
  const withAgents = fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'subagents')))
    .sort(
      (a, b) =>
        fs.statSync(path.join(dir, b, 'subagents')).mtimeMs - fs.statSync(path.join(dir, a, 'subagents')).mtimeMs,
    );
  const session = sessionId ?? withAgents[0];
  if (!session || !withAgents.includes(session)) throw new Error(`no subagents for session ${session ?? '(none)'}`);
  const sub = path.join(dir, session, 'subagents');
  for (const file of fs.readdirSync(sub).filter((f) => f.endsWith('.jsonl'))) {
    const metaFile = path.join(sub, file.replace(/\.jsonl$/, '.meta.json'));
    const label = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')).description : file;
    const s = agentSummary(fs.readFileSync(path.join(sub, file), 'utf8').split('\n').filter(Boolean));
    const gatePct = s.minutes ? Math.round((s.gateSec / 60 / s.minutes) * 100) : 0;
    console.log(
      `${label}: ${s.minutes.toFixed(1)} min · ${s.turns} turns · ${(s.cacheRead / 1e6).toFixed(1)}M cache read · ${s.calls} calls (${s.errors} failed) · gates ${Math.round(s.gateSec)} s (${gatePct}%)`,
    );
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function cost() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`CLAUDE.md (loaded every turn): ${kb(fs.statSync(path.join(ROOT, 'CLAUDE.md')).size)}`);
  for (const script of COST_SCRIPTS) {
    const start = Date.now();
    const { status, stdout, stderr } = spawnSync(npm, ['run', '-s', script], { cwd: ROOT, encoding: 'utf8' });
    const out = stdout + stderr;
    console.log(
      `npm run ${script}: ${((Date.now() - start) / 1000).toFixed(1)} s, ${kb(out.length)}, ${out.split('\n').length} lines${status ? `, exit ${status}` : ''}`,
    );
  }
}

function transcripts(limit) {
  const dir = path.join(os.homedir(), '.claude', 'projects', ROOT.replace(/[^\w]/g, '-'));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, limit);
  const logs = files.map((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean));
  const sessions = logs.map(parseSession);
  const names = fs.readdirSync(path.join(ROOT, '.claude', 'skills'));
  const { output, slow, pairs, denied } = summarize(sessions);
  console.log(
    `${files.length} sessions, ${sessions.flat().length} tool calls\n\nLargest output (total · max · calls):`,
  );
  for (const k of output) console.log(`  ${k.key}: ${kb(k.bytes)} · ${kb(k.maxBytes)} · ${k.count}`);
  console.log('\nSlowest call (elapsed, including any permission wait):');
  for (const k of slow) console.log(`  ${k.key}: ${(k.maxMs / 1000).toFixed(0)} s`);
  console.log('\nCommand pairs repeated across sessions (sessions · times):');
  for (const p of pairs) console.log(`  ${p.pair}: ${p.sessions} · ${p.count}`);
  console.log('\nDenied by the permission classifier · rejected by the user:');
  for (const d of denied) console.log(`  ${d.key}: ${d.denied} · ${d.rejected}`);
  console.log('\nSkill runs (runs · sessions · longest run to the next prompt):');
  const runs = logs.map((lines) => skillRuns(lines, names));
  for (const name of names) {
    const mine = runs.map((r) => r.filter((run) => run.skill === name));
    const all = mine.flat();
    const longest = all.length ? `${Math.round(Math.max(...all.map((r) => r.ms)) / 60000)} min` : 'never run';
    console.log(`  ${name}: ${all.length} · ${mine.filter((r) => r.length).length} · ${longest}`);
  }
}

function scripts() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.startsWith('docs/images/') && !['package-lock.json', 'CHANGELOG.md'].includes(f))
    .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  for (const [file, source] of files.filter(([f]) => /^scripts\/[^/]+\.js$/.test(f))) {
    const name = path.basename(file, '.js');
    const by = callers(name, files);
    const notes = [by.length ? `called by ${by.join(', ')}` : 'NO CALLER'];
    if (argsWithoutUsage(source)) notes.push('reads arguments, no usage line');
    console.log(`${name}: ${notes.join('; ')}`);
  }
}

if (require.main === module) {
  const [flag, ...rest] = process.argv.slice(2);
  const limit = Number(flag?.startsWith('--transcripts') ? (flag.split('=')[1] ?? 20) : 20);
  if (rest.length || (flag && !/^--(cost|transcripts(=\d+)?|agents(=[\w-]+)?)$/.test(flag)) || !(limit > 0)) {
    console.error('Usage: node scripts/setup-facts.js [--cost | --transcripts[=N] | --agents[=SESSION_ID]]');
    process.exit(1);
  }
  if (flag?.startsWith('--agents')) {
    try {
      agents(flag.split('=')[1]);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  } else if (flag === '--cost') cost();
  else if (flag?.startsWith('--transcripts')) transcripts(limit);
  else scripts();
}

module.exports = { callers, argsWithoutUsage, commandKey, parseSession, skillRuns, summarize, agentSummary };
