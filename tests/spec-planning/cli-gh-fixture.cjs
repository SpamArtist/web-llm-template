#!/usr/bin/env node
// Subprocess contract fixture. Unknown requests fail; this program never uses a network client.
import('node:fs').then((fs) => {
  const statePath = process.env.SPEC_PLANNING_TEST_GH_STATE;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const args = process.argv.slice(2);
  const methodIndex = args.indexOf('--method');
  const method = methodIndex < 0 ? 'GET' : args[methodIndex + 1];
  const endpoint = args.find((arg) => arg.startsWith('repos/'));
  const input = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : undefined;
  state.requests.push({ method, endpoint, input });

  function reply(status, body) {
    fs.writeFileSync(statePath, JSON.stringify(state));
    if (!args.includes('--silent')) {
      if (args.includes('--include')) process.stdout.write(`HTTP/2.0 ${status} Fixture\r\nContent-Type: application/json\r\n\r\n`);
      process.stdout.write(JSON.stringify(body));
    }
    process.exitCode = status >= 400 ? 1 : 0;
  }

  if (args[0] !== 'api' || args[args.indexOf('--hostname') + 1] !== 'github.com') {
    reply(400, { message: 'Only explicit github.com API calls are allowed.' });
  } else if (endpoint === 'repos/example/generated') {
    reply(200, { full_name: 'example/generated', default_branch: 'main', clone_url: 'https://github.com/example/generated.git', permissions: { push: state.writable } });
  } else if (endpoint === 'repos/example/generated/git/ref/heads/main') {
    reply(200, { object: { sha: 'a'.repeat(40) } });
  } else if (endpoint.startsWith('repos/example/generated/contents/')) {
    reply(state.installed ? 200 : 404, { message: state.installed ? 'Installed' : 'Missing' });
  } else if (method === 'GET' && endpoint.startsWith('repos/example/generated/labels/')) {
    const name = decodeURIComponent(endpoint.slice('repos/example/generated/labels/'.length));
    reply(state.labels.includes(name) ? 200 : 404, { name });
  } else if (method === 'POST' && endpoint === 'repos/example/generated/labels') {
    if (state.labels.includes(input.name)) reply(422, { message: 'Duplicate label creation.' });
    else {
      state.labels.push(input.name);
      state.writes.push({ method, endpoint, input });
      reply(201, input);
    }
  } else reply(400, { message: `Unexpected fixture operation: ${method} ${endpoint}` });
}).catch((error) => { console.error(error); process.exitCode = 1; });
