'use strict';

// Claude Code PreToolUse hook on Bash (.claude/settings.json): refuses killing processes by name, whose
// pattern matches the agent's own shell (exit 144) and can miss the server. Denials go to dev-metrics.

// Command position: line start, after a separator or `$(`, or behind sudo/xargs.
const AT = String.raw`(?:^|[;&|(\x60\n]|\$\()\s*(?:(?:sudo|xargs)\s+)?`;
const BY_NAME = [
  new RegExp(`${AT}(?:pkill|killall)\\b`, 'm'),
  new RegExp(`${AT}kill\\b.*\\$\\(\\s*pgrep\\b`, 'm'),
  new RegExp(`${AT}pgrep\\b.*\\|\\s*xargs\\s+kill\\b`, 'm'),
];

const REASON =
  'never pkill/killall/kill $(pgrep …): the pattern matches this shell itself (exit 144) and can miss the server. ' +
  'Stop servers with `node scripts/mock-server.js down` or `node scripts/dev-server.js down`; ' +
  'anything else by its port, `fuser -k <port>/tcp`, or its pid.';

// The refusal reason for `command`, or null to let it run.
const verdict = (command) => (BY_NAME.some((re) => re.test(command)) ? REASON : null);

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    const command = JSON.parse(input).tool_input?.command ?? '';
    const reason = verdict(command);
    if (!reason) return;
    require('./dev-metrics').record('bash-guard', { command });
    console.error(reason);
    process.exit(2);
  });
}

module.exports = { verdict };
