# web-tag

~1.5KB gzipped. Vanilla TS, no dependencies at runtime.

## Install

```html
<script async
        src="https://t.themia.app/t.js"
        data-project="7f9b5c2e-1d4a-4f8b-9c3e-6a2b8d5f1e40"></script>
```

Serve `/t.js` from a subdomain CNAMEd at the ingest host. The tag defaults its
API host to wherever it was served from, so first-party proxying needs no extra
configuration.

To queue calls before the script has loaded:

```html
<script>window.fr=window.fr||function(){(fr.q=fr.q||[]).push(arguments)}</script>
```

## Consent

Nothing is stored and nothing is sent until you say so. Events that happen while
the banner is still up are held in memory, and sent only if the answer is yes.

```js
fr('consent', true);   // persist a visitor id, send what was held
fr('consent', false);  // clear the id and drop what was held
```

## Download links

Write markup, not URLs. The tag rewrites the `href` and re-rewrites it when
consent changes.

```html
<a data-fr-download data-fr-asset="Themia-Setup" data-fr-version="1.4.2">
  Download for Windows
</a>
```

Or build one yourself:

```js
location.href = fr('download', 'Themia-Setup', '1.4.2');
```

The URL points at `/v1/download`, which mints a token and redirects to an
installer whose **filename carries that token**. That filename is the only thing
that survives the jump from this page into the installed app.

## Everything else

```js
fr('event', 'clicked_pricing', { plan: 'pro' });
fr('identify', 'acct_42');   // an account id seen on both surfaces is an exact join
fr('page');                  // SPA route change
fr('flush');
```

## Budget

The build fails above 3KB gzipped. `bun run check:size`, and `test/size.test.ts`
enforces the same number in `bun test`.
