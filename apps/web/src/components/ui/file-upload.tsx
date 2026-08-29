import { FileField } from "@kobalte/core/file-field";
import { Show, createSignal, type JSX } from "solid-js";
import { UploadIcon } from "lucide-solid";
import { cn } from "../../lib/cn.js";

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
  children?: JSX.Element;
  class?: string;
}

export async function downscaleImage(file: File, maxDimension: number): Promise<string> {
  // SVG is already resolution independent, and rasterising it would throw that
  // away. Everything else goes through a canvas.
  if (file.type === "image/svg+xml") return readAsDataUrl(file);

  const dataUrl = await readAsDataUrl(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("That file is not an image we can read."));
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
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export function FileUpload(props: FileUploadProps) {
  const [busy, setBusy] = createSignal(false);

  return (
    <FileField
      accept={props.accept ?? "image/png,image/jpeg,image/webp,image/svg+xml"}
      multiple={false}
      disabled={props.disabled || busy()}
      onFileAccept={async (files) => {
        const file = files[0];
        if (!file) return;
        setBusy(true);
        try {
          const dataUrl = await downscaleImage(file, props.maxDimension ?? 256);
          props.onFile(dataUrl, file.type === "image/svg+xml" ? file.type : "image/png");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileField.Dropzone
        class={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors",
          "hover:border-ring hover:bg-accent/40 data-[dragging]:border-ring data-[dragging]:bg-accent/40",
          props.class
        )}
      >
        <Show
          when={props.children}
          fallback={
            <>
              <UploadIcon class="size-5 text-muted-foreground" />
              <div class="text-sm">{busy() ? "Processing…" : "Drop an image, or click to choose"}</div>
              <div class="text-xs text-muted-foreground">PNG, JPEG, WebP or SVG</div>
            </>
          }
        >
          {props.children}
        </Show>
        <FileField.Trigger class="sr-only">Choose a file</FileField.Trigger>
      </FileField.Dropzone>
      <FileField.HiddenInput />
    </FileField>
  );
}
