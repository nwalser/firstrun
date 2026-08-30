import ImagePlus from "lucide-solid/icons/image-plus";
import { Show, createSignal } from "solid-js";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  FileUpload,
  Spinner,
  initials,
} from "./ui/index.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * The workspace logo: what it looks like now, and how to change it.
 *
 * The logo lives in Postgres as bytes rather than on disk, because Railway's
 * filesystem is ephemeral -- a file written on one deploy is gone on the next.
 * That is only a reasonable place to put an image because of the downscale
 * below: `FileUpload` runs `downscaleImage(file, 256)` in the browser, so the
 * 4MB PNG somebody drags in becomes tens of kilobytes before a single byte is
 * sent, stored or served. Without it this would be a blob store.
 *
 * There is always something in the slot -- the image, or the workspace's
 * initials -- so an unset logo reads as "not set yet" rather than as a hole
 * where a picture failed to load.
 */

/** Mirrors MAX_LOGO_BYTES in db/repo.ts. The server re-checks; this is the message. */
const MAX_BYTES = 512 * 1024;

/** SVG is deliberately absent: see `accepts` below. */
const ALLOWED = /^image\/(png|jpeg|webp)$/;

/** The longest edge the browser downscales to before anything is sent. */
const MAX_DIMENSION = 256;

export function LogoField(props: {
  name: string;
  logoUpdatedAt: string | null;
  src: string;
  onUpload: (dataUrl: string) => Promise<void>;
  onClear: () => Promise<void>;
  disabled?: boolean;
}) {
  const i18n = useI18n();

  // Held so the new logo is on screen the instant it is picked. The server
  // round trip and the router invalidation take a moment, and a slot that keeps
  // showing the old image for that moment reads as a failed upload.
  const [preview, setPreview] = createSignal<string | null>(null);
  const [size, setSize] = createSignal<number | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // `logoUpdatedAt` is the cache key. Without it the browser keeps serving the
  // logo it already has for this URL and a replacement looks like it did not
  // save -- the same reason the route sets an ETag on the response.
  const stored = () =>
    props.logoUpdatedAt ? `${props.src}?v=${encodeURIComponent(props.logoUpdatedAt)}` : undefined;
  const shown = () => preview() ?? stored();
  const hasLogo = () => Boolean(preview() ?? props.logoUpdatedAt);

  async function accept(dataUrl: string) {
    setError(null);

    // The type is read out of the data URL rather than off the File, because
    // the data URL is the only thing the server sees and it is what the server
    // will validate. SVG gets here on purpose: it is in the accept list so that
    // dropping one produces this sentence instead of nothing at all.
    const type = dataUrl.slice(5, dataUrl.indexOf(";"));
    if (!ALLOWED.test(type)) {
      // Three keys rather than one sentence with a noun phrase pushed into it:
      // "That file" is a subject, and a subject substituted into a translated
      // sentence is a fragment that German would want in another case.
      setError(
        type === "image/svg+xml"
          ? i18n.t("settings.logo_svg_rejected")
          : type
            ? i18n.t("settings.logo_type_rejected", { type })
            : i18n.t("settings.logo_file_rejected")
      );
      return;
    }

    const bytes = dataUrlBytes(dataUrl);
    if (bytes > MAX_BYTES) {
      setError(
        i18n.t("settings.logo_too_large", {
          size: i18n.fileSize(bytes),
          limit: i18n.fileSize(MAX_BYTES),
        })
      );
      return;
    }

    const previous = preview();
    setPreview(dataUrl);
    setSize(bytes);
    setBusy(true);
    try {
      await props.onUpload(dataUrl);
    } catch (cause) {
      // Put back what was on screen: leaving the preview up would claim a save
      // that did not happen, and the next reload would silently contradict it.
      setPreview(previous);
      setSize(null);
      setError(cause instanceof Error ? cause.message : i18n.t("settings.logo_save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await props.onClear();
      setPreview(null);
      setSize(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : i18n.t("settings.logo_save_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="flex flex-wrap items-start gap-4">
      <div class="flex w-16 flex-col items-center gap-1.5">
        {/* Square, not round: a logo is a mark, and cropping one to a circle
            eats the corners of most of them. */}
        <Avatar class="size-16 rounded-md bg-muted/30">
          <AvatarImage
            src={shown()}
            alt={i18n.t("settings.logo_alt", { name: props.name })}
            class="rounded-md object-contain"
          />
          <AvatarFallback class="rounded-md text-body">{initials(props.name)}</AvatarFallback>
        </Avatar>
        <Show when={size()}>
          {(bytes) => (
            <span class="text-small tabular-nums text-muted-foreground">
              {i18n.fileSize(bytes())}
            </span>
          )}
        </Show>
      </div>

      <div class="flex min-w-56 flex-1 flex-col gap-2">
        <FileUpload
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          maxDimension={MAX_DIMENSION}
          disabled={props.disabled || busy()}
          onFile={(dataUrl) => void accept(dataUrl)}
        >
          <ImagePlus class="size-5 text-muted-foreground" />
          <div class="text-body">
            {hasLogo()
              ? i18n.t("settings.logo_drop_replacement")
              : i18n.t("settings.logo_drop")}
          </div>
          <div class="text-caption text-muted-foreground">
            {i18n.t("settings.logo_hint", { size: MAX_DIMENSION })}
          </div>
        </FileUpload>

        <div class="flex items-center gap-2">
          <Show when={hasLogo()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="hover:text-negative"
              disabled={props.disabled || busy()}
              onClick={() => void clear()}
            >
              {i18n.t("common.remove")}
            </Button>
          </Show>
          <Show when={busy()}>
            <span class="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Spinner class="size-3.5" />
              {i18n.t("common.saving")}
            </span>
          </Show>
        </div>

        <Show when={error()}>
          {(message) => <p class="text-body text-negative">{message()}</p>}
        </Show>
      </div>
    </div>
  );
}

/** Bytes behind a base64 data URL, without decoding it. */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
