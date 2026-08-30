import type { Namespaced } from "./namespace.js";

/** The sign-in screen and everything that can go wrong on it. */
export const auth = {
  "auth.sign_in": "Sign in",
  "auth.sign_in_with_github": "Continue with GitHub",
  "auth.signing_in": "Signing in…",
  "auth.tagline":
    "One self-hosted analytics backend for everything you ship: your site, your app, your " +
    "backend, on your own Postgres.",
  "auth.privacy_note":
    "We read your public profile and email address. Nothing is posted on your behalf.",
  "auth.failed": "Sign-in did not work. Try again.",
  "auth.session_expired": "Your session has expired. Sign in again.",

  "auth.not_configured": "GitHub sign-in is not configured",
  // The two environment variable names arrive as vars rather than as markup in
  // the middle of the sentence. A key that carried the markup would have to be
  // three keys, and three fragments do not survive German word order.
  "auth.not_configured_hint": "Set {first} and {second}, or mint a local session out of band:",

  // The inert preview beside the form. It is `aria-hidden`, but it is still on
  // the screen, and a German page with an English caption on it reads as
  // broken rather than as decorative.
  "auth.preview_per_day": "{name} per day",
  "auth.preview_retention": "Day 7 retention",
} satisfies Namespaced<"auth">;

export type AuthMessages = typeof auth;
