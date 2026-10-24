import { executeBootstrap } from './workflow.js';

const flags = new Map([
  ['session', 'session'], ['owner', 'owner'], ['project', 'project'], ['automation', 'automation'],
  ['migration', 'migration'], ['state', 'state'], ['action', 'action'], ['reason', 'reason'],
  ['previous-session', 'previousSession'], ['stopped', 'stopped'], ['explicit', 'explicit'],
  ['inventory-confirmed', 'inventoryConfirmed'],
]);
const booleans = new Set(['stopped', 'explicit', 'inventory-confirmed']);
try {
  const [command = 'status', ...args] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const flag = arg.startsWith('--') ? arg.slice(2) : '';
    if (!flags.has(flag)) throw new Error(`Unknown bootstrap argument: ${arg}`);
    const value = booleans.has(flag) ? true : args[++index];
    if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) throw new Error(`Missing value for --${flag}`);
    if (flags.get(flag) in options) throw new Error(`Duplicate bootstrap argument: --${flag}`);
    options[flags.get(flag)] = value;
  }
  console.log(JSON.stringify(executeBootstrap(command, options), null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
