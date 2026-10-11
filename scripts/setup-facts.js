'use strict';

// Facts for the setup-review skill.
//   node scripts/setup-facts.js                    each script's callers (tests and the changelog excluded —
//                                                  a script only they mention has no caller), and which read
//                                                  arguments without printing a usage line
//   node scripts/setup-facts.js --cost             time and output size of the gates an agent runs
//   node scripts/setup-facts.js --transcripts[=N|=DATE]  the last N (default 20) sessions', or everything
//                                                  after DATE's, largest outputs, slowest calls, repeated command
//                                                  pairs, denied and rejected calls, and the newest entry read;
//                                                  commands are reduced to their first words, so no arguments
//                                                  (or secrets) print; then interrupts and how the user answered
//                                                  each skill's questions
//     --digest=DIR                                 also writes one file per session to DIR: prompts, the reply
//                                                  before each, skill runs, failed calls, interrupts, rejections
//                                                  with the user's reason, questions and answers — long tokens
//                                                  redacted, for the subagent that reads for judgment
//                                                  and which docs were read, how often whole
//   node scripts/setup-facts.js --agents[=ID]      per subagent of session ID (default: the newest with any):
//                                                  time, turns, cache reads, failed calls, time in tests/e2e/commits, all tool time and its top commands

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

// One line, long tokens (keys, hashes) redacted, cut at `max` characters.
function clip(value, max) {
  const flat = value
    .replace(/[\w+/=-]{24,}/g, '[…]')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// A question about the Claude Code setup, by its text and option labels (descriptions mention scripts too often).
const SETUP = /CLAUDE\.md|SKILL\.md|settings(\.local)?\.json|scripts\/|\b(skill|hook|memory)s?\b/i;

// One AskUserQuestion question and its answer → `recommended` (the first option, or the one marked so),
// `other` (another option), `own` (free text) or `clarify`/`dismissed` when the user rejected the call.
function answerOutcome(question, answer, rejection) {
  if (rejection !== undefined) return /clarify/.test(rejection) ? 'clarify' : 'dismissed';
  const labels = question.options.map((o) => o.label);
  const recommended = labels.find((l) => /\(Recommended\)/.test(l)) ?? labels[0];
  if (answer === recommended) return 'recommended';
  return answer.split(', ').every((a) => labels.includes(a)) ? 'other' : 'own';
}

// One session's JSONL lines → what a reader needs for judgment, in order: `{ kind, … }` with kind
// `prompt` (`text`, `reply`: the last assistant text before it), `skill`, `error` (`key`, `text`),
// `interrupt` (`key`: the call before it), `rejected` (`key`, `reason`) or `answer` (`skill`: the
// one running, `question`, `answer`, `outcome`, `setup`: it proposes a setup change).
function sessionEvents(lines, names) {
  const events = [];
  const calls = new Map();
  let reply = '';
  let skill;
  let lastKey;
  for (const line of lines) {
    const entry = JSON.parse(line);
    const content = entry.message?.content;
    const started = typeof content === 'string' && content.match(/<command-name>\/([\w:-]+)<\/command-name>/)?.[1];
    if (names.includes(started)) events.push({ kind: 'skill', skill: (skill = started) });
    else if (isPrompt(entry)) {
      const prompt = text(content);
      if (prompt.startsWith('[Request interrupted by user')) events.push({ kind: 'interrupt', key: lastKey });
      else {
        skill = undefined;
        events.push({ kind: 'prompt', text: clip(prompt, 500), reply: clip(reply, 200) });
      }
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (entry.type === 'assistant' && part.type === 'text' && part.text.trim()) reply = part.text;
      if (part.type === 'tool_use') {
        const key = part.name === 'Bash' ? commandKey(part.input.command ?? '') : part.name;
        calls.set(part.id, { key, input: part.input });
        if (part.name === 'Skill' && names.includes(part.input.skill))
          events.push({ kind: 'skill', skill: (skill = part.input.skill) });
      }
      if (part.type !== 'tool_result' || !calls.has(part.tool_use_id)) continue;
      const { key, input } = calls.get(part.tool_use_id);
      lastKey = key;
      const out = text(part.content);
      const rejection = /^The user doesn't want to proceed/.test(out)
        ? (out.split('the user said:\n')[1] ?? '').split('\n\nNote')[0]
        : undefined;
      if (key === 'AskUserQuestion' && (rejection !== undefined || !part.is_error)) {
        const answers = entry.toolUseResult?.answers ?? {};
        for (const question of input.questions ?? [])
          events.push({
            kind: 'answer',
            skill,
            question: clip(question.question, 200),
            answer: clip(answers[question.question] ?? '', 200),
            outcome: answerOutcome(question, answers[question.question] ?? '', rejection),
            setup: SETUP.test([question.question, ...question.options.map((o) => o.label)].join(' ')),
          });
      } else if (rejection !== undefined) events.push({ kind: 'rejected', key, reason: clip(rejection, 300) });
      else if (part.is_error && !/^Permission for this action was denied/.test(out))
        events.push({ kind: 'error', key, text: clip(out.split('\n').find((l) => l.trim()) ?? '', 150) });
    }
  }
  return events;
}

// A digest file's text for `sessionEvents`' output.
function digest(events) {
  const show = {
    prompt: (e) => `${e.reply ? `  (agent: ${e.reply})\n` : ''}> ${e.text}`,
    skill: (e) => `== skill ${e.skill}`,
    error: (e) => `  ✗ ${e.key}: ${e.text}`,
    interrupt: (e) => `  ⏹ interrupted after ${e.key ?? 'a reply'}`,
    rejected: (e) => `  ⊘ rejected ${e.key}${e.reason ? `: ${e.reason}` : ''}`,
    answer: (e) => `  ? [${e.outcome}${e.setup ? ', setup' : ''}] ${e.question} → ${e.answer}`,
  };
  return events.map((e) => show[e.kind](e)).join('\n') + '\n';
}

// Per running skill (or `-`): how the user answered its questions, setup proposals counted apart.
function answerStats(sessions) {
  const stats = new Map();
  for (const e of sessions.flat().filter((e) => e.kind === 'answer')) {
    const name = e.setup ? `${e.skill ?? '-'} (setup proposals)` : (e.skill ?? '-');
    const s = stats.get(name) ?? { name, recommended: 0, other: 0, own: 0, clarify: 0, dismissed: 0 };
    s[e.outcome]++;
    stats.set(name, s);
  }
  return [...stats.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Shell commands that only read or inspect, and tools (capitalized or MCP): a pair with one of them is
// exploring or editing, not a procedure to script.
const READS = new Set(['grep', 'rg', 'sed', 'cat', 'head', 'tail', 'ls', 'find', 'wc', 'awk', 'python3', 'jq', 'echo']);
const isCommand = (key) => !/^[A-Z]|^mcp__/.test(key) && !READS.has(key);

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
      [...pairs.values()].filter((p) => p.sessions.size >= 2 && p.pair.split(' → ').every(isCommand)),
      (p) => p.sessions.size * 1000 + p.count,
    ).map((p) => ({ pair: p.pair, count: p.count, sessions: p.sessions.size })),
    denied: keys
      .filter((k) => k.denied || k.rejected)
      .map((k) => ({ key: k.key, denied: k.denied, rejected: k.rejected })),
  };
}

// A repo doc a Read call or a shell read (cat, sed, head, tail) opened: CLAUDE.md, README.md or under docs/.
const DOC = /(?:^|[\s/"'])((?:docs\/[\w/-]+|README|CLAUDE)\.md)\b/g;

// One session's JSONL lines → `{ doc, whole }` per doc opened, `whole` unless the read was narrowed (a Read
// offset or limit, or sed/head/tail rather than cat).
function docReads(lines) {
  const reads = [];
  for (const line of lines)
    for (const part of [JSON.parse(line).message?.content].flat()) {
      if (part?.type !== 'tool_use') continue;
      const { file_path: file, offset, limit, command } = part.input ?? {};
      if (part.name === 'Read')
        for (const [, doc] of ` ${file ?? ''}`.matchAll(DOC))
          reads.push({ doc, whole: offset === undefined && limit === undefined });
      if (part.name === 'Bash' && /\b(cat|sed|head|tail)\b/.test(command ?? ''))
        for (const [, doc] of command.matchAll(DOC)) reads.push({ doc, whole: /\bcat\b/.test(command) });
    }
  return reads;
}

// `sessions`: arrays of docReads' reads → per doc, `{ doc, reads, whole, sessions }`, most read first.
function docReadStats(sessions) {
  const stats = new Map();
  sessions.forEach((reads, session) => {
    for (const { doc, whole } of reads) {
      const s = stats.get(doc) ?? { doc, reads: 0, whole: 0, sessions: new Set() };
      s.reads++;
      s.whole += whole ? 1 : 0;
      s.sessions.add(session);
      stats.set(doc, s);
    }
  });
  return [...stats.values()]
    .map((s) => ({ ...s, sessions: s.sessions.size }))
    .sort((a, b) => b.reads - a.reads || a.doc.localeCompare(b.doc));
}

// Commands whose time is the gates' (tests, e2e, commit hooks), not the agent's thinking.
const GATE = /^(npm test|npm run test(:one|:e2e)?|node scripts\/e2e\.js|git commit)$/;

// One subagent's JSONL lines → `{ minutes, turns, cacheRead, calls, errors, gateSec, toolSec, topTools }`. A response
// spans several lines, each repeating its usage so far, so each field's max per message id counts.
function agentSummary(lines) {
  const entries = lines.map((line) => JSON.parse(line));
  const stamps = entries.filter((e) => e.timestamp).map((e) => Date.parse(e.timestamp));
  const cache = new Map();
  for (const e of entries)
    if (e.type === 'assistant' && e.message?.id)
      cache.set(e.message.id, Math.max(cache.get(e.message.id) ?? 0, e.message.usage?.cache_read_input_tokens ?? 0));
  const calls = parseSession(lines);
  const byKey = new Map();
  for (const c of calls) byKey.set(c.key, (byKey.get(c.key) ?? 0) + c.ms / 1000);
  return {
    minutes: stamps.length ? (Math.max(...stamps) - Math.min(...stamps)) / 60000 : 0,
    turns: cache.size,
    cacheRead: [...cache.values()].reduce((a, b) => a + b, 0),
    calls: calls.length,
    errors: calls.filter((c) => c.error).length,
    gateSec: calls.filter((c) => GATE.test(c.key)).reduce((s, c) => s + c.ms, 0) / 1000,
    toolSec: calls.reduce((s, c) => s + c.ms, 0) / 1000,
    topTools: [...byKey].sort((a, b) => b[1] - a[1]).slice(0, 3),
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
    const pct = (sec) => (s.minutes ? Math.round((sec / 60 / s.minutes) * 100) : 0);
    const top = s.topTools.map(([key, sec]) => `${key} ${Math.round(sec)} s`).join(', ');
    console.log(
      `${label}: ${s.minutes.toFixed(1)} min · ${s.turns} turns · ${(s.cacheRead / 1e6).toFixed(1)}M cache read · ${s.calls} calls (${s.errors} failed) · gates ${Math.round(s.gateSec)} s (${pct(s.gateSec)}%) · tools ${Math.round(s.toolSec)} s (${pct(s.toolSec)}%: ${top})`,
    );
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function cost() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`CLAUDE.md (loaded every turn): ${kb(fs.statSync(path.join(ROOT, 'CLAUDE.md')).size)}`);
  const docs = fs
    .readdirSync(path.join(ROOT, 'docs'), { recursive: true })
    .filter((f) => f.endsWith('.md'))
    .map((f) => [`docs/${f.split(path.sep).join('/')}`, fs.statSync(path.join(ROOT, 'docs', f)).size])
    .sort((a, b) => b[1] - a[1]);
  console.log(
    `Largest docs: ${docs
      .slice(0, 5)
      .map(([f, size]) => `${f} ${kb(size)}`)
      .join(', ')}`,
  );
  for (const script of COST_SCRIPTS) {
    const start = Date.now();
    const { status, stdout, stderr } = spawnSync(npm, ['run', '-s', script], { cwd: ROOT, encoding: 'utf8' });
    const out = stdout + stderr;
    console.log(
      `npm run ${script}: ${((Date.now() - start) / 1000).toFixed(1)} s, ${kb(out.length)}, ${out.split('\n').length} lines${status ? `, exit ${status}` : ''}`,
    );
  }
}

// A session's JSONL lines after `since` (ms); lines without a timestamp stay with their neighbours.
function linesSince(lines, since) {
  return lines.filter((line) => {
    const t = JSON.parse(line).timestamp;
    return !t || Date.parse(t) > since;
  });
}

// `{ limit }` or `{ since }` (ms): the newest `limit` sessions, or every entry after `since`.
function transcripts({ limit, since }, digestDir) {
  const dir = path.join(os.homedir(), '.claude', 'projects', ROOT.replace(/[^\w]/g, '-'));
  const sorted = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const files = since === undefined ? sorted.slice(0, limit) : sorted.filter((f) => fs.statSync(f).mtimeMs > since);
  const read = files
    .map((f) => [path.basename(f, '.jsonl'), fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)])
    .map(([id, lines]) => [id, since === undefined ? lines : linesSince(lines, since)])
    .filter(([, lines]) => lines.length);
  const logs = read.map(([, lines]) => lines);
  const sessions = logs.map(parseSession);
  const newest = logs
    .flat()
    .reduce((max, line) => Math.max(max, Date.parse(JSON.parse(line).timestamp ?? '') || 0), since ?? 0);
  const names = fs.readdirSync(path.join(ROOT, '.claude', 'skills'));
  const events = logs.map((lines) => sessionEvents(lines, names));
  if (digestDir) {
    fs.mkdirSync(digestDir, { recursive: true });
    read.forEach(([id], i) => fs.writeFileSync(path.join(digestDir, `${id}.txt`), digest(events[i])));
  }
  const { output, slow, pairs, denied } = summarize(sessions);
  console.log(
    `${logs.length} sessions, ${sessions.flat().length} tool calls, newest entry ${newest ? new Date(newest).toISOString() : 'none'}\n\nLargest output (total · max · calls):`,
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
  const interrupts = events.flat().filter((e) => e.kind === 'interrupt');
  console.log(
    `\nInterrupts: ${interrupts.length} in ${events.filter((s) => s.some((e) => e.kind === 'interrupt')).length} sessions`,
  );
  console.log(
    '\nQuestions by running skill (recommended taken · other option · own answer · asked to clarify · dismissed):',
  );
  for (const s of answerStats(events))
    console.log(`  ${s.name}: ${s.recommended} · ${s.other} · ${s.own} · ${s.clarify} · ${s.dismissed}`);
  console.log('\nDocs read (reads · whole · transcripts, subagents counted apart):');
  // Subagents read docs on the session's behalf, so their transcripts count here.
  const subagentLogs = read.flatMap(([id]) => {
    const sub = path.join(dir, id, 'subagents');
    return fs.existsSync(sub)
      ? fs
          .readdirSync(sub)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => fs.readFileSync(path.join(sub, f), 'utf8').split('\n').filter(Boolean))
      : [];
  });
  const existing = (d) => fs.existsSync(path.join(ROOT, d.doc)); // not a test fixture's made-up path
  for (const d of docReadStats([...logs, ...subagentLogs].map(docReads)).filter(existing))
    console.log(`  ${d.doc}: ${d.reads} · ${d.whole} · ${d.sessions}`);
  if (digestDir) console.log(`\nDigests: ${read.length} files in ${digestDir}`);
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
  const [flag, ...more] = process.argv.slice(2);
  const digestDir = flag?.startsWith('--transcripts')
    ? more.find((a) => a.startsWith('--digest='))?.slice(9)
    : undefined;
  const rest = more.filter((a) => digestDir === undefined || a !== `--digest=${digestDir}`);
  const value = flag?.startsWith('--transcripts') ? (flag.split('=')[1] ?? '20') : '20';
  const range = /^\d+$/.test(value) ? { limit: Number(value) } : { since: Date.parse(value) };
  if (
    rest.length ||
    (flag && !/^--(cost|transcripts(=[\w:.+-]+)?|agents(=[\w-]+)?)$/.test(flag)) ||
    !(range.limit > 0 || range.since > 0)
  ) {
    console.error(
      'Usage: node scripts/setup-facts.js [--cost | --transcripts[=N|=DATE] [--digest=DIR] | --agents[=SESSION_ID]]',
    );
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
  else if (flag?.startsWith('--transcripts')) transcripts(range, digestDir);
  else scripts();
}

module.exports = {
  callers,
  argsWithoutUsage,
  commandKey,
  parseSession,
  linesSince,
  skillRuns,
  answerOutcome,
  sessionEvents,
  digest,
  answerStats,
  summarize,
  agentSummary,
  docReads,
  docReadStats,
};
