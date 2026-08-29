import { createSession, deleteSession, upsertGithubUser, userForSession, type User } from "@firstrun/db";
import { ensureReady, getStore } from "./context.server.js";

/**
 * GitHub OAuth, and the session cookie it produces.
 *
 * There is no password to store and no password reset to build, at the cost of
 * a dependency on GitHub being up and on two secrets existing in the
 * environment. `bun run dev:login` mints a session out of band so development
 * is not blocked on those secrets -- deliberately a CLI and not a route,
 * because an auth bypass reachable over HTTP is an auth bypass whatever the
 * environment variable around it says.
 */

export const SESSION_COOKIE = "fr_session";
const STATE_COOKIE = "fr_oauth_state";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Absolute, and must match the callback registered with GitHub exactly. */
  callbackUrl: string;
}

export function oauthConfig(req: Request): OAuthConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const origin = process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
  return {
    clientId,
    clientSecret,
    callbackUrl: `${origin.replace(/\/$/, "")}/auth/github/callback`,
  };
}

function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

function isSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

/** The signed-in user for this request, or null. */
export async function currentUser(req: Request): Promise<User | null> {
  await ensureReady();
  return userForSession(getStore().db, readCookie(req, SESSION_COOKIE));
}

// ---------------------------------------------------------------------------
// The three routes
// ---------------------------------------------------------------------------

export function startGithubLogin(req: Request): Response {
  const config = oauthConfig(req);
  if (!config) {
    return new Response(
      "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, " +
        "or use `bun run dev:login <login>` locally.\n",
      { status: 503, headers: { "Content-Type": "text/plain" } }
    );
  }

  // CSRF: the value goes out in a cookie and comes back in the query string.
  // If they disagree, the callback was not started by this browser.
  const state = crypto.randomUUID();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": cookie(STATE_COOKIE, state, 600, isSecure(req)),
    },
  });
}

export async function finishGithubLogin(req: Request): Promise<Response> {
  const config = oauthConfig(req);
  if (!config) return new Response("GitHub OAuth is not configured", { status: 503 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, STATE_COOKIE);

  if (!code || !state || !expected || state !== expected) {
    return new Response("Login could not be verified. Start again from /login.", { status: 400 });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });

  const tokenBody = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
  const accessToken = tokenBody?.access_token;
  if (!accessToken) return new Response("GitHub did not return a token", { status: 502 });

  const profileRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  if (!profileRes.ok) return new Response("GitHub did not return a profile", { status: 502 });

  const profile = (await profileRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };

  await ensureReady();
  const user = await upsertGithubUser(getStore().db, {
    githubId: profile.id,
    login: profile.login,
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatar_url,
  });

  const session = await createSession(getStore().db, user.id);
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session.token, 30 * 24 * 60 * 60, isSecure(req)));
  // The state cookie has done its job.
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0, isSecure(req)));

  return new Response(null, { status: 302, headers });
}

export async function logout(req: Request): Promise<Response> {
  await ensureReady();
  await deleteSession(getStore().db, readCookie(req, SESSION_COOKIE));
  return new Response(null, {
    status: 302,
    headers: { Location: "/login", "Set-Cookie": cookie(SESSION_COOKIE, "", 0, isSecure(req)) },
  });
}
