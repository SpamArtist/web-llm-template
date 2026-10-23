import { assertRegisteredOwner, getBootstrapContext } from './context.js';
import { recoverUpdateLock, updateRegistry } from './store.js';

const nativeStates = ['active', 'paused', 'deleted', 'absent', 'unknown'];
const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value;
};
function holder(record, session) {
  required(session, 'Codex session');
  if (record.reservation?.sessionId !== session) throw new Error('Setup belongs to another session. Reconcile or explicitly recover the stopped setup.');
}
function enabled(record) {
  if (record.phase === 'disabled') throw new Error('Planning was disabled. An explicit enable request is required.');
}
function identity(record, automation) {
  required(automation, 'Native automation ID');
  if (record.automationId && record.automationId !== automation) throw new Error('Native automation identity differs from the registered workflow.');
}
function initialRecord(context, session) {
  return {
    version: 1, repository: context.repository, planningRoot: context.checkout,
    phase: 'reserved', reservation: { sessionId: session, reservedAt: new Date().toISOString() },
    ownerId: null, projectId: null, automationId: null, previousAutomationIds: [],
    initialCheck: { state: 'pending', sessionId: null }, disabledReason: null,
    migration: null, nativeObservation: null,
  };
}
function observe(record, options) {
  if (!nativeStates.includes(options.state)) throw new Error('Native state must be active, paused, deleted, absent, or unknown.');
  if (options.state !== 'unknown' && options.state !== 'absent') identity(record, options.automation);
  if (options.automation && record.automationId) identity(record, options.automation);
  record.nativeObservation = {
    state: options.state, automationId: options.automation || record.automationId,
    observedAt: new Date().toISOString(),
  };
  if (options.state === 'unknown') return record;
  if (['paused', 'deleted'].includes(options.state)
    || (options.state === 'absent' && record.automationId)) {
    // A missing known ID is a deletion, never an invitation to recreate it.
    record.automationId ||= options.automation || null;
    record.phase = 'disabled';
    record.disabledReason = `native-${options.state}`;
    record.reservation = null;
  } else if (options.state === 'absent' && record.phase === 'creating') {
    if (!options.inventoryConfirmed) throw new Error('Uncertain creation requires authoritative complete native inventory before retry.');
    holder(record, options.session);
    record.phase = 'ready';
  }
  return record;
}

/** Mutations only record tool-confirmed decisions; this code never edits native automation files. */
export function executeBootstrap(command, options = {}, cwd = process.cwd(), env = process.env) {
  const context = getBootstrapContext(cwd, env);
  if (command === 'status') return context;
  if (command === 'recover-lock') return recoverUpdateLock(context, options);
  if (command === 'guard') {
    const record = context.record;
    if (context.attention || !record || record.phase !== 'active' || context.checkout !== record.planningRoot
      || record.ownerId !== options.owner || record.automationId !== options.automation || options.state !== 'active') {
      throw new Error('Planning guard failed. Reconcile native status, checkout, and owner before running.');
    }
    assertRegisteredOwner(record);
    return { allowed: true, ...context };
  }
  if (context.attention) throw new Error(`${context.attention}: preserve the original checkout and recover drafts before changing registration.`);
  const record = updateRegistry(context, current => {
    if (command === 'reserve') {
      required(options.session, 'Codex session');
      if (!current) return initialRecord(context, options.session);
      enabled(current);
      if (current.phase === 'active') return current;
      if (current.reservation && current.reservation.sessionId !== options.session) holder(current, options.session);
      current.reservation ||= { sessionId: options.session, reservedAt: new Date().toISOString() };
      return current;
    }
    if (!current) throw new Error('Reserve the workflow before configuring it.');
    if (command === 'native-reconcile') return observe(current, options);
    if (command === 'disable') {
      current.phase = 'disabled';
      current.disabledReason = options.reason || 'explicit-user-disable';
      current.reservation = null;
      return current;
    }
    if (command === 'enable') {
      if (!options.explicit) throw new Error('Enable requires an explicit user request (--explicit).');
      if (current.phase !== 'disabled') throw new Error('Only a disabled workflow needs enabling.');
      required(options.session, 'Codex session');
      current.phase = current.ownerId && current.projectId ? 'ready' : 'reserved';
      if (current.automationId && ['deleted', 'absent'].includes(current.nativeObservation?.state)) {
        current.previousAutomationIds.push(current.automationId);
        current.automationId = null;
        current.nativeObservation = null;
        current.initialCheck = { state: 'pending', sessionId: null };
      }
      current.disabledReason = null;
      current.reservation = { sessionId: options.session, reservedAt: new Date().toISOString() };
      // A paused identity is retained and re-enabled; only confirmed deletion permits replacement.
      return current;
    }
    enabled(current);
    if (command === 'recover') {
      if (!options.stopped || !options.previousSession) throw new Error('Recovery requires a verified stopped session and its ID.');
      holder(current, options.previousSession);
      required(options.session, 'Replacement Codex session');
      current.reservation = { sessionId: options.session, reservedAt: new Date().toISOString() };
      return current;
    }
    if (command === 'initial-check') {
      if (current.phase !== 'active') throw new Error('Activate the schedule before the initial check.');
      required(options.session, 'Codex session');
      if (options.action === 'begin') {
        if (current.initialCheck.state !== 'pending') throw new Error('Initial check already started. Reconcile its run before proceeding.');
        current.initialCheck = { state: 'running', sessionId: options.session };
      } else if (options.action === 'complete') {
        if (current.initialCheck.state !== 'running' || current.initialCheck.sessionId !== options.session) throw new Error('Initial check belongs to another run.');
        current.initialCheck.state = 'complete';
      } else if (options.action === 'recover') {
        if (!options.stopped || current.initialCheck.state !== 'running'
          || current.initialCheck.sessionId !== options.previousSession) {
          throw new Error('Initial-check recovery requires its verified stopped run.');
        }
        current.initialCheck = { state: 'pending', sessionId: null };
      } else throw new Error('Initial check action must be begin, complete, or recover.');
      return current;
    }
    holder(current, options.session);
    if (command === 'defer') {
      if (current.phase === 'creating') throw new Error('Creation may have succeeded. Reconcile before releasing the reservation.');
      current.reservation = null;
    } else if (command === 'register') {
      if (!['reserved', 'ready'].includes(current.phase)) throw new Error('Owner registration is only allowed before creation.');
      required(options.owner, 'Owner ID');
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(options.owner)) throw new Error('Owner must be the UUID from existing planning setup.');
      required(options.project, 'Codex project ID');
      if (current.ownerId && current.ownerId !== options.owner) throw new Error('Preserve the existing owner and drafts.');
      if (current.projectId && current.projectId !== options.project) throw new Error('Preserve the registered Codex project.');
      if (options.migration) {
        if (current.migration && current.migration.automationId !== options.migration) throw new Error('Migration predecessor is already registered.');
        if (current.automationId) {
          if (current.automationId !== options.migration || current.nativeObservation?.state !== 'paused'
            || current.nativeObservation.automationId !== options.migration) {
            throw new Error('Converting a bound legacy task requires explicit enable and confirmed paused predecessor identity.');
          }
          // Only explicit enable can reopen a bound paused task into a registration phase.
          current.automationId = null;
          current.nativeObservation = null;
        }
        current.migration ||= { automationId: options.migration, pauseConfirmed: false };
      }
      assertRegisteredOwner({ ...current, ownerId: options.owner });
      current.ownerId = options.owner;
      current.projectId = options.project;
      current.phase = 'ready';
    } else if (command === 'migration-paused') {
      if (!current.migration || current.migration.automationId !== options.automation) throw new Error('Migration predecessor does not match.');
      current.migration.pauseConfirmed = true;
    } else if (command === 'begin-create') {
      if (current.phase !== 'ready' || current.automationId) throw new Error('Creation requires ready state with no known native automation. Reconcile first.');
      if (current.migration && !current.migration.pauseConfirmed) throw new Error('Confirm the predecessor is paused before creating its replacement.');
      if (current.nativeObservation?.state !== 'absent') throw new Error('Confirm no matching native workflow exists before creation.');
      current.phase = 'creating';
      // A crash after this write remains ambiguous even if the tool call never started.
      current.nativeObservation = null;
    } else if (command === 'activate') {
      if (!['creating', 'ready'].includes(current.phase)) throw new Error('Workflow is not awaiting native activation.');
      identity(current, options.automation);
      if (current.nativeObservation?.state !== 'active' || current.nativeObservation.automationId !== options.automation) {
        throw new Error('Record a confirmed active native observation before activation.');
      }
      if (current.migration && (!current.migration.pauseConfirmed || current.migration.automationId === options.automation)) {
        throw new Error('Replacement must differ from its paused migration predecessor.');
      }
      current.automationId = options.automation;
      current.phase = 'active';
      current.nativeObservation = { state: 'active', automationId: options.automation, observedAt: new Date().toISOString() };
      current.reservation = null;
    } else throw new Error(`Unknown bootstrap command: ${command}`);
    return current;
  }, options.session);
  return { ...context, record };
}
