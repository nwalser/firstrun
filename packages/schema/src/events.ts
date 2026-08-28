/**
 * The canonical event names milestone 1 knows about.
 *
 * The funnel is built from exactly these. Anything else a customer sends is
 * stored and ignored by the funnel query — we are not building an explore view.
 */
export const EVENT = {
  /** Web. A page was viewed. Step 1 of the funnel. */
  PAGE_VIEW: "page_view",
  /** Server. Written by /v1/download when a token is minted. Step 2. */
  DOWNLOAD_STARTED: "download_started",
  /** App. The installation ran for the first time. Step 3. */
  APP_FIRST_RUN: "app_first_run",
  /** App. Any subsequent launch. Feeds day-7 retention (step 4) and the version breakdown. */
  APP_LAUNCH: "app_launch",
  /** App or web. Money changed hands. Step 5. */
  PURCHASE: "purchase",
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

/** The five numbers on the one screen, in order. */
export const FUNNEL_STEPS = [
  { key: "visited", label: "Visited", event: EVENT.PAGE_VIEW },
  { key: "downloaded", label: "Downloaded", event: EVENT.DOWNLOAD_STARTED },
  { key: "first_run", label: "First run", event: EVENT.APP_FIRST_RUN },
  { key: "day7", label: "Day 7", event: EVENT.APP_LAUNCH },
  { key: "paid", label: "Paid", event: EVENT.PURCHASE },
] as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];
