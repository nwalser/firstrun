/**
 * Download tokens. The token lives in the installer's filename — that is the
 * whole trick, so the encoding has to survive being read back off a Windows
 * path by an NSIS regex and by a human squinting at a Downloads folder.
 *
 * Crockford base32: no I, L, O or U, so nothing collides with 1/0 visually and
 * nothing accidentally spells a word. 5 random bytes is 40 bits, which is
 * exactly 8 symbols with no padding.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const TOKEN_LENGTH = 8;
export const TOKEN_BYTES = 5;

/** Matches a bare token. */
export const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * Matches a token at the tail of an installer filename.
 * Kept byte-identical to the NSIS hook and the Rust Downloads-folder scan —
 * if you change one, change all three.
 */
export const TOKEN_IN_FILENAME_RE = /-([0-9A-HJKMNP-TV-Z]{8})\.exe$/i;

export function encodeToken(bytes: Uint8Array): string {
  if (bytes.length !== TOKEN_BYTES) {
    throw new Error(`token needs exactly ${TOKEN_BYTES} bytes, got ${bytes.length}`);
  }
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = TOKEN_LENGTH - 1; i >= 0; i--) {
    const idx = Number((bits >> BigInt(i * 5)) & 31n);
    out += ALPHABET[idx];
  }
  return out;
}

export function mintToken(rng: (n: number) => Uint8Array = defaultRng): string {
  return encodeToken(rng(TOKEN_BYTES));
}

function defaultRng(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

export function isToken(s: string): boolean {
  return TOKEN_RE.test(s);
}

/** Pull the token out of `Themia-Setup-1.4.2-9GQ4T7BX.exe`. */
export function tokenFromFilename(filename: string): string | null {
  const m = TOKEN_IN_FILENAME_RE.exec(filename);
  return m ? m[1]!.toUpperCase() : null;
}

/** Build the filename the browser will save. The token has to be the last segment. */
export function installerFilename(asset: string, version: string, token: string): string {
  return `${asset}-${version}-${token}.exe`;
}

/** Default token lifetime. Long enough for "download at work, install at home". */
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
