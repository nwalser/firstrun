import { Outlet, createFileRoute } from "@tanstack/solid-router";

/**
 * The log, and one entry from it.
 *
 * A pass-through with nothing of its own, the same shape the sources area has.
 * An entry gets a page rather than only an expanding row because an entry is
 * something people SEND each other: "this is the one the crash reporter
 * mentioned" is a link, and a link has to open on the thing itself rather than
 * on a list somebody then has to scroll.
 *
 * The list keeps its inline detail as well. Opening a row in place is how you
 * read a log; opening the page is how you cite one.
 */
export const Route = createFileRoute("/w/$wslug/events")({
  component: () => <Outlet />,
});
