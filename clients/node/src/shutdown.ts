/**
 * Process-wide shutdown hooks, installed once and shared by every client.
 *
 * One set of listeners rather than one set per client, for two reasons. Node
 * warns on stderr at eleven listeners for an event, and this library is not
 * allowed to write to the host's stderr. And a signal must be handled once,
 * not once per instance.
 *
 * The signal rule is the careful part. Adding a `SIGTERM` listener stops Node
 * from terminating on `SIGTERM`. A host that installed its own handler already
 * decides when to exit, so we flush alongside it and touch nothing. A host with
 * no handler is relying on the default, so after flushing we remove ourselves
 * and re-raise, which restores exactly the exit the host would have had.
 */

type Hook = () => Promise<unknown>;

const hooks = new Set<Hook>();
const SIGNALS = ["SIGTERM", "SIGINT"] as const;
let installed = false;

function hasProcess(): boolean {
  return typeof process !== "undefined" && typeof process.on === "function";
}

async function runHooks(): Promise<void> {
  // Each hook is already bounded by its own flush timeout and already swallows
  // its own errors; `allSettled` is belt and braces so one cannot stop another.
  await Promise.allSettled(Array.from(hooks, (h) => h()));
}

function onBeforeExit(): void {
  if (hooks.size === 0) return;
  // Returning a promise from `beforeExit` keeps the process alive until it
  // settles. If there is nothing queued the hooks resolve immediately and the
  // process exits on the next turn, so this cannot livelock.
  void runHooks();
}

function makeSignalHandler(signal: NodeJS.Signals): () => void {
  return function handler(): void {
    // Ours is one of them. Anything else means the host is in charge of exiting.
    const hostHandles = process.listeners(signal).length > 1;
    void runHooks().then(() => {
      if (hostHandles) return;
      process.removeListener(signal, handler);
      // No listeners left, so this is the default action: terminate.
      process.kill(process.pid, signal);
    });
  };
}

const signalHandlers = new Map<NodeJS.Signals, () => void>();

function install(): void {
  if (installed || !hasProcess()) return;
  installed = true;
  process.on("beforeExit", onBeforeExit);
  for (const sig of SIGNALS) {
    const handler = makeSignalHandler(sig);
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }
}

function uninstall(): void {
  if (!installed || !hasProcess()) return;
  installed = false;
  process.removeListener("beforeExit", onBeforeExit);
  for (const [sig, handler] of signalHandlers) process.removeListener(sig, handler);
  signalHandlers.clear();
}

/** Registers a hook. Returns the function that removes it. */
export function registerShutdownHook(hook: Hook): () => void {
  if (!hasProcess()) return () => {};
  hooks.add(hook);
  install();
  return () => {
    hooks.delete(hook);
    // The last client to close takes the listeners with it, so a process that
    // creates and closes clients does not accumulate handlers.
    if (hooks.size === 0) uninstall();
  };
}
