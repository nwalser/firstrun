# Identity

Three optional attributes, three setters, three lifespans. Nothing else, in any client.

```
user(id)      -> user.id       until it is cleared
device(id)    -> device.id     forever
session(id)   -> session.id    until it is replaced
```

There is no `identify()`, no `reset()` and no `newSession()`. Signing out is `user(null)`.
Rotating a session is `session(<a new id>)`.

## All three are optional, and absent is an answer

An entry carrying none of the three is a legal entry. It is stored, indexed and queried exactly
like any other; it is counted as an entry and in no unique. On a backend that is the ordinary
case, not a degraded one.

This is the point of the change that removed `distinct_id`. That column was NOT NULL, so every
client had to invent something to put in it, and what they invented was a fiction: in a browser a
storage key pretending to be a device, on a server a process pretending to be a person. A number
built on an invented id looks exactly like a number built on a real one, which is the worst
property a number can have.

So nothing is invented anywhere. A client fills a slot in for itself **only** where the platform
genuinely knows the answer.

## What each client fills in by itself

| client | `device.id` | `session.id` | `user.id` |
|---|---|---|---|
| browser tag | only with `data-fingerprint` **and** consent | yes: 30 idle minutes, or a new referring site | never |
| `sdk/tauri` | yes: the id it persists to local app data | yes: one run is one session | never |
| `clients/dotnet` | yes, unless `PersistDeviceId = false` | yes, unless `SessionPerProcess = false` | never |
| `clients/node` | never | never | never |
| `clients/go` | never | never | never |
| `clients/python` | never | never | never |

The desktop clients fill in a device because a desktop install IS a machine, and a session because
one run of an app is one sitting. The server clients fill in nothing because a process is not a
person, a request is not a visit, and a fleet of pods restarting is not a crowd of new machines.
What a backend measures is the developer's decision, and they make it by calling the setters.

`user.id` is never filled in by anybody. It is only ever the string the customer passed.

## Where a persisted id lives

A client that persists a `device.id` writes it to **machine-local** storage. On Windows that is
`%LOCALAPPDATA%`, never `%APPDATA%`: a roaming profile syncs the roaming folder between machines,
so one person signing in to three of them would share one id and report as one install instead of
three. Tying somebody across machines is what `user()` is for.

`user.id` is **never** written to disk, in any client. A persisted user id outliving a sign-out is
how the wrong person gets attributed.

## The two rules

**1. Identity travels as one unit, from one layer.**

Every client with layers (a per-call identity, an ambient request scope, a client-level default)
takes all three from the innermost layer that states any of them, and does not consult the layers
below it for the other two. Nothing is merged across layers.

Three independent fallback chains is the bug, and it is the one the next person will write. A
background job recorded inside a request handler names its own device and inherits the requester's
`user.id`; the unique below coalesces `user.id` first, so that job's entries are counted as that
customer. Stating an identity has to replace the identity, not a third of it.

Where a language can express it, `null` counts as stating one: it means "nobody", explicitly.
Leaving all three out is silence, and silence inherits.

**2. Naming a different person cuts the session.**

A sign-in is a boundary, and one session spanning two accounts belongs to neither. Naming the same
person again is a no-op and must stay one: a router calls `user()` on every route change, and a
session per route change is not a session.

That is the whole cascade. There is nothing else.

## What a unique is

One definition, in `db/query.ts`, and nowhere else:

```sql
coalesce(attributes ->> 'user.id', attributes ->> 'device.id', attributes ->> 'session.id')
```

Best available identity wins: a named user is one person, a device is one install, a session is
one visit. NULL for an entry that carries none of the three, and `count(distinct ...)` ignores
nulls, so such entries are counted in no unique at all.

Scoped inside one source, always. **Never sum uniques across sources.** The same human on the
site and in the app is two uniques, and that is the correct answer.

## The browser fingerprint

The one derived id in the product, and it is gated twice: `fingerprint: true` in the tag's config
(or `data-fingerprint` on the script tag) AND `consent(true)` from the visitor. Both, never one.

It hashes screen geometry, the device pixel ratio, the timezone, the language and the two hardware
counters. No canvas and no WebGL: hundreds of bytes against the tag's budget, milliseconds on
somebody else's main thread, and randomised by every serious privacy tool anyway.

What comes out **collides between two identical machines and changes when the OS updates or the
window moves to a second monitor**. It is a trend line, not a headcount. Say that in those words
wherever it is offered, and do not quietly widen it into something that sounds reliable.

Whether it is lawful where a customer operates is the customer's question. It is off until they
answer it.

`device()` remains available to a caller who genuinely knows the machine, such as a page inside a
Tauri or Electron shell. That needs no fingerprint flag, because nothing is being derived: it is
the customer telling us a fact about their own installation. It still needs consent to be sent.

## What is not here, and is not coming back

- No `distinct_id`, in any shape, under any name.
- No `session.previous_id`, and no other breadcrumb tying one session to the one before it.
  Rotating a session ends it.
- No stitching of an anonymous id to a named one, on the server or anywhere else.
- No linking of two sources in one project. No inference, no probabilistic matching, no IP
  heuristics, no merging, ever. A customer who wants a person joined across surfaces calls
  `user()` with the same id on both. That is their data and their decision.

Three ids travelling together, one of them a stable device and one a person, is the SHAPE of the
cross-surface identity join this product deleted. The line is that we store what the customer set,
on the source that set it, and never join across sources. Nothing above is permission to revisit
that.
