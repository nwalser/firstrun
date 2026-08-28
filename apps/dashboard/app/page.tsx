/**
 * There is one screen in milestone 1 and this is not it.
 *
 * No nav, no project list, no settings. If you got here you want
 * /projects/<id>/funnel, and `bun run seed` prints the id.
 */
export default function Index() {
  return (
    <main className="wrap">
      <h1>Nothing here</h1>
      <p className="lede">
        The only screen is <code>/projects/&lt;project-id&gt;/funnel</code>. Run <code>bun run seed</code>;
        it prints the id and the URL.
      </p>
    </main>
  );
}
