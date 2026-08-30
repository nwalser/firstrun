# Delivery policy

How a client decides WHEN to send what it has collected. Applies to all five client libraries and
the browser tag, with the per-surface exceptions noted at the end.

## Two axes, and conflating them is the mistake

Scheduling and durability look like one setting and are not.

- **Schedule** decides when a send is attempted.
- **Durability** decides what is still there after a crash or a kill.

"Send once at startup" is not a schedule on its own: it is a schedule that never fires during the
run, combined with a queue that survives to the next run. Model them separately or the combination
that people actually want cannot be expressed.

## Schedule

```
DeliveryMode =
  | "immediate"   // send as soon as a batch can be formed
  | "interval"    // every `every`, or when `maxBatch` is reached, whichever first
  | "startup"     // drain whatever survived from last run, then never during this run
  | "manual"      // only when flush() is called
```

**`immediate` still batches and still never blocks.** It means "do not wait for a timer", not "one
request per entry". Entries produced in the same tick coalesce into one batch. A loop calling
`event()` a thousand times must produce a handful of requests, not a thousand. Anyone who reads
"live" as synchronous has broken the rule that firstrun is never in the caller's critical path.

**`interval` is the default.** It carries `every` (a duration) and `maxBatch` (a count), and fires
on whichever comes first.

**`startup`** drains the persisted queue at init and then accumulates for the next run. This is the
quietest possible mode: one burst of requests per launch. It is only meaningful with disk
persistence, see below.

**`manual`** is for tests and for a caller who wants to decide. `flush()` is the only trigger.

## Durability

```
Persistence = "memory" | "disk"
```

`disk` writes the pending queue somewhere durable and drains it on next start. It is what makes a
crash report survive the crash that produced it, which is the whole point of collecting one.

**`startup` with `memory` is incoherent**: nothing survives the run, so nothing is ever sent. Do
not silently accept it. Either reject it at config time with a clear message, or coerce it to
`disk` and emit a diagnostic saying so. Silently sending nothing is the worst of the three.

## Orthogonal settings

- **`flushOnSeverity`** (default: ERROR). Any entry at or above this severity sends immediately,
  whatever the schedule says. A crash report that waits five minutes for the next tick is a crash
  report that usually does not arrive, because the process is gone. This single setting is most of
  the value of having a policy at all.
- **`flushOnExit`** (default: true). A best-effort, time-bounded flush during shutdown. Bounded,
  because a slow network must not hold a process open.
- **`maxBatch`** must not exceed the server's per-request entry cap. Check the wire format rather
  than guessing: exceeding it means every request is rejected and the queue never drains, which
  presents as total silence.

## Interaction with the reliability rules

The delivery policy never overrides these. They are in CLAUDE.md and they outrank it.

- A timer must not spin while the circuit breaker is open or the network is down. Back off; do not
  attempt on schedule regardless of outcome.
- The bounded queue still drops oldest when full and still counts what it dropped. A long interval
  with a small queue silently loses data, so a queue that is dropping should be visible through the
  stats or diagnostics hook.
- `immediate` must not turn into one request per entry under load. Coalesce.
- No mode may block the caller, throw into the host, or write to the host's stdout or stderr.

## Per-surface reality

**Browser: `immediate` by default.** A page does not live long enough for a timer to be worth
waiting for, and a visit that ends before the first tick sends nothing at all. Live is the honest
default here.

`immediate` still coalesces: entries produced in the same tick go out together, so a page view plus
three clicks is a small number of beacons, not four. The existing flush on `visibilitychange` to
hidden and on `pagehide` stays as a backstop for whatever was produced since the last send.

Persistence is memory. A durable queue in `localStorage` sounds appealing and means unsent
analytics sitting on the disk of a visitor who never returns, which is what consent withdrawal is
supposed to prevent.

**Desktop (Tauri, .NET): memory, flushed on exit.** Nothing is written to the user's disk, and a
run's telemetry goes out as one burst when the application closes. Quiet, and it leaves no trace
between runs.

**This has one consequence worth stating plainly, because it works against error reporting.** A
memory-only queue that sends at exit is precisely the configuration in which a crash loses
everything, including the report of the crash. The process died, there was no clean exit, and the
buffer went with it. The most valuable single entry a desktop app can send is the one describing
why it just stopped.

The mitigation is `flushOnSeverity`, which is why it defaults to ERROR: an entry at or above that
level is sent at the moment it is logged rather than at exit, so it leaves the process while the
process still exists. That costs nothing at rest, because most runs log no errors at all.

A residual gap remains and disk persistence is the only thing that closes it: a hard crash can kill
the process before an in-flight request completes, and a request that never left is a request that
is gone. If crash coverage matters more than leaving no trace, the narrow fix is to persist ONLY
entries at or above ERROR, which keeps ordinary telemetry in memory and writes a few bytes only on
the rare occasion something has already gone wrong.

**Server (Node, Go, Python).** Long-lived, so `interval` at a short period is right. Disk
persistence is usually wrong: a server that crashes is generally being restarted by something that
will not preserve local state, and writing telemetry to a container filesystem is a surprise.
Default to memory and say why.

## Defaults

| surface | schedule | persistence | flushOnSeverity |
|---|---|---|---|
| browser | `immediate`, coalesced, plus hide/pagehide as a backstop | memory | ERROR |
| desktop | `manual` with flush on exit | memory | ERROR (sends at once, see above) |
| server | `interval` 15s | memory | ERROR |

Every default is overridable. The point of the policy is that a customer who wants one burst per
launch, or a live feed while debugging, can have either without editing the library.
