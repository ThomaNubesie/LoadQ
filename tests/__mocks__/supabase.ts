// Chainable Supabase mock used by every services test. Services chain
// multiple queries per call (joinQueue alone hits ~4 tables), so the
// mock holds a FIFO queue of results — each terminal call (`.single()`,
// `.maybeSingle()`, or awaiting the builder directly) pops the next
// result and returns it. Tests prime the queue with `pushResult(...)`
// in the order the service makes its queries.
//
// All query method invocations (from, select, eq, etc.) are recorded so
// assertions can inspect the exact filter shape the service wrote.

type Result = { data: any; error: any };

const DEFAULT: Result = { data: null, error: null };

export const _state: { queue: Result[]; user: any | null; functionResult: Result } = {
  queue: [],
  user:  null,
  functionResult: { ...DEFAULT },
};

export function pushResult(data: any, error: any = null): void {
  _state.queue.push({ data, error });
}

export function setUser(user: any | null): void {
  _state.user = user;
}

export function setFunctionResult(data: any, error: any = null): void {
  _state.functionResult = { data, error };
}

export function resetSupabaseMock(): void {
  _state.queue.length        = 0;
  _state.user                = null;
  _state.functionResult      = { ...DEFAULT };
  fromCalls.length           = 0;
  insertCalls.length         = 0;
  updateCalls.length         = 0;
  selectCalls.length         = 0;
  eqCalls.length             = 0;
  gteCalls.length            = 0;
  lteCalls.length            = 0;
  orderCalls.length          = 0;
  limitCalls.length          = 0;
  inCalls.length             = 0;
  neqCalls.length            = 0;
  isCalls.length             = 0;
  rpcCalls.length            = 0;
  invokeCalls.length         = 0;
}

function nextResult(): Result {
  return _state.queue.shift() ?? { ...DEFAULT };
}

// Call recorders.
export const fromCalls:   string[]          = [];
export const insertCalls: any[]             = [];
export const updateCalls: any[]             = [];
export const selectCalls: string[]          = [];
export const eqCalls:     [string, any][]   = [];
export const gteCalls:    [string, any][]   = [];
export const lteCalls:    [string, any][]   = [];
export const orderCalls:  [string, any][]   = [];
export const limitCalls:  number[]          = [];
export const inCalls:     [string, any[]][] = [];
export const neqCalls:    [string, any][]   = [];
export const isCalls:     [string, any][]   = [];
export const rpcCalls:    [string, any][]   = [];
export const invokeCalls: [string, any][]   = [];

function makeBuilder(): any {
  const builder: any = {};
  const passthrough: { [k: string]: (...args: any[]) => void } = {
    select:  (...args) => { selectCalls.push(args[0] ?? "*"); },
    insert:  (payload) => { insertCalls.push(payload); },
    update:  (payload) => { updateCalls.push(payload); },
    upsert:  (payload) => { insertCalls.push(payload); },
    delete:  () => {},
    eq:      (col: string, val: any) => { eqCalls.push([col, val]); },
    neq:     (col: string, val: any) => { neqCalls.push([col, val]); },
    in:      (col: string, vals: any[]) => { inCalls.push([col, vals]); },
    is:      (col: string, val: any) => { isCalls.push([col, val]); },
    gte:     (col: string, val: any) => { gteCalls.push([col, val]); },
    lte:     (col: string, val: any) => { lteCalls.push([col, val]); },
    gt:      () => {},
    lt:      () => {},
    or:      () => {},
    order:   (col: string, opts: any) => { orderCalls.push([col, opts]); },
    limit:   (n: number) => { limitCalls.push(n); },
    range:   () => {},
  };
  for (const name of Object.keys(passthrough)) {
    builder[name] = (...args: any[]) => { passthrough[name](...args); return builder; };
  }
  let resolved = false;
  const resolveOnce = () => {
    if (resolved) {
      // Repeated awaits on the same chain — return default to avoid eating
      // another queue entry the test didn't intend to feed.
      return Promise.resolve(DEFAULT);
    }
    resolved = true;
    return Promise.resolve(nextResult());
  };
  builder.single      = () => resolveOnce();
  builder.maybeSingle = () => resolveOnce();
  builder.then = (onResolve: any, onReject?: any) =>
    resolveOnce().then(onResolve, onReject);
  return builder;
}

export const supabase = {
  from: (table: string) => {
    fromCalls.push(table);
    return makeBuilder();
  },
  auth: {
    getUser: () => Promise.resolve({ data: { user: _state.user }, error: null }),
    getSession: () => Promise.resolve({ data: { session: _state.user ? { user: _state.user } : null }, error: null }),
    signInWithOtp: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    verifyOtp:    jest.fn(() => Promise.resolve({ data: { user: _state.user }, error: null })),
    signOut:      jest.fn(() => Promise.resolve({ error: null })),
    updateUser:   jest.fn(() => Promise.resolve({ data: { user: _state.user }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
  },
  functions: {
    invoke: (name: string, args: any) => {
      invokeCalls.push([name, args]);
      return Promise.resolve(_state.functionResult);
    },
  },
  rpc: (name: string, args: any) => {
    rpcCalls.push([name, args]);
    return Promise.resolve(nextResult());
  },
  channel: () => ({
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn(() => Promise.resolve("ok")),
    unsubscribe: jest.fn(() => Promise.resolve()),
  }),
  removeChannel: jest.fn(),
};
