import { spawnSync } from 'node:child_process';

// Resolve only the deploying repository's existing Git credential; never log it.
const credential = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\npath=home-afk/project-hub.git\n\n',
  encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});
const fields = Object.fromEntries((credential.stdout ?? '').trim().split('\n').map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
if (credential.status !== 0 || !fields.password) {
  console.error('The deploying repository has no usable noninteractive Git credential.');
  process.exit(1);
}
const ref = process.argv[2] ?? 'main';
const response = await fetch(`https://api.github.com/repos/home-afk/project-hub/commits/${encodeURIComponent(ref)}/status`, {
  headers: { Authorization: `Bearer ${fields.password}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Project-Hub-Release-Check' },
});
if (!response.ok) {
  console.error(`GitHub deployment status unavailable (${response.status}).`);
  process.exit(1);
}
const body = await response.json();
console.log(JSON.stringify({ sha: body.sha, state: body.state,
  statuses: body.statuses.map(({ context, state, target_url }) => ({ context, state, target_url })),
}, null, 2));
