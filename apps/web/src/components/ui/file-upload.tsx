import { FileField } from "@kobalte/core/file-field";
import { Show, createSignal, type JSX } from "solid-js";
import Upload from "lucide-solid/icons/upload";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";

/**
 * A drop zone, on Kobalte's file-field.
 *
 * The primitive supplies the hidden input, the drag state and the label
 * association; what is added here is the shadcn surface and the downscale.
 *
 * Images are resized in the browser before they are ever sent. A 4MB photo
 * dropped on a 32px avatar slot has no business being uploaded, stored or
 * served, and doing it here means the server's size limit is a backstop rather
 * than something users hit.
 */

export interface FileUploadProps {
  accept?: string;
  /** Longest edge, in pixels, after downscaling. */
  maxDimension?: number;
  disabled?: boolean;
  onFile: (dataUrl: string, mimeType: string) => void;
  /**
   * Told when a dropped file cannot be read.
   *
   * Optional, and the message is shown under the dropzone either way: reading a
   * file is the one step here that fails for reasons the person can act on --
   * a renamed `.png` that is really a PDF, a corrupt download -- and without
   * this the rejection went nowhere and the drop just appeared to do nothing.
   */
  onError?: (message: string) => void;
  children?: JSX.Element;
  class?: string;
}

/**
 * Why a dropped file could not be read, as a code rather than as a sentence.
 *
 * The two functions below run outside the component tree -- `downscaleImage` is
 * exported and awaited from an event handler -- so they have no locale to
 * translate against. They throw a code and the component turns it into the
 * message the reader sees, which is the only place a locale exists.
 */
export const FILE_ERROR = {
  notAnImage: "firstrun.file.not-an-image",
  unreadable: "firstrun.file.unreadable",
} as const;

export async function downscaleImage(file: File, maxDimension: number): Promise<string> {
  // SVG is already resolution independent, and rasterising it would throw that
  // away. Everything else goes through a canvas.
  if (file.type === "image/svg+xml") return readAsDataUrl(file);

  const dataUrl = await readAsDataUrl(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(FILE_ERROR.notAnImage));
    image.src = dataUrl;
  });

  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  if (scale === 1 && dataUrl.length < 200_000) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(FILE_ERROR.unreadable));
    reader.readAsDataURL(file);
  });
}

export function FileUpload(props: FileUploadProps) {
  const i18n = useI18n();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  return (
    <FileField
      accept={props.accept ?? "image/png,image/jpeg,image/webp,image/svg+xml"}
      multiple={false}
      disabled={props.disabled || busy()}
      onFileAccept={async (files) => {
        const file = files[0];
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
          const dataUrl = await downscaleImage(file, props.maxDimension ?? 256);
          props.onFile(dataUrl, file.type === "image/svg+xml" ? file.type : "image/png");
        } catch (e) {
          // Anything that is not the "this is not an image" code -- a read
          // failure, a canvas that refused -- reads the same to the person
          // holding the file, and that was the old fallback too.
          const code = e instanceof Error ? e.message : FILE_ERROR.unreadable;
          const message =
            code === FILE_ERROR.notAnImage
              ? i18n.t("ui.not_an_image")
              : i18n.t("ui.file_unreadable");
          setError(message);
          props.onError?.(message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileField.Dropzone
        class={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md p-6 text-center",
          // The one place in this set that keeps a real border: the edge has to
          // be dashed, and a box-shadow ring cannot be. It is the same hairline
          // token the rings use, so it matches them, and there is no shadow
          // class on this element to double it with.
          "border border-dashed border-border transition-[background-color,border-color]",
          "hover:bg-accent data-[dragging]:border-ring data-[dragging]:bg-accent",
          props.class
        )}
      >
        {/*
          The branch is decided on the KEY, not on the children.

          `when={props.children}` would read the prop to test it, and reading a
          markup prop *builds its nodes* -- during hydration that claims the
          server's nodes, in order, from wherever the test happens rather than
          from where the content belongs. The default branch is the one the
          server wrote here, so the claim lands on the wrong element and Solid
          throws a hydration mismatch. Its own error path then fails to print
          itself and what reaches the console is `template2 is not a function`,
          with half the page rendered a second time. `in` asks whether the
          caller passed the prop without invoking the getter, so the children
          are read exactly once and only in the place that holds them.
        */}
        <Show
          when={"children" in props}
          fallback={
            <>
              <Upload class="size-5 text-muted-foreground" />
              <div class="text-body font-medium">
                {busy() ? i18n.t("ui.processing") : i18n.t("ui.drop_image")}
              </div>
              <div class="text-caption text-muted-foreground">{i18n.t("ui.image_formats")}</div>
            </>
          }
        >
          {props.children}
        </Show>
        <FileField.Trigger class="sr-only">{i18n.t("ui.choose_file")}</FileField.Trigger>
      </FileField.Dropzone>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="text-caption text-negative mt-2">
            {message()}
          </p>
        )}
      </Show>
      <FileField.HiddenInput />
    </FileField>
  );
}
