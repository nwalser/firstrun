import { AlertDialog as KAlertDialog } from "@kobalte/core/alert-dialog";
import {
  createContext,
  createSignal,
  Show,
  splitProps,
  useContext,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";
import { Button, buttonVariants } from "./button.js";
import { Field } from "./field.js";
import { Input } from "./input.js";
import { Spinner } from "./spinner.js";

/**
 * The confirmation modal, on Kobalte's alert-dialog.
 *
 * Separate from dialog.tsx because the role differs -- `role="alertdialog"`,
 * announced as an interruption -- and because of one behaviour: focus lands on
 * Cancel, not on the action. Everything this opens for destroys something, and
 * a dialog that deletes a workspace when someone hits Enter to make it go away
 * is a dialog that deletes workspaces by accident. `AlertDialogAction` is
 * `destructive` by default for the same reason.
 */

export const AlertDialog = KAlertDialog;
export const AlertDialogTrigger = KAlertDialog.Trigger;

/**
 * Lets the content focus the cancel button without knowing where in the tree
 * the caller put it, which a querySelector for it would have to assume.
 */
const RegisterCancel = createContext<(el: HTMLElement) => void>();

export function AlertDialogContent(
  props: ComponentProps<typeof KAlertDialog.Content> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  let cancel: HTMLElement | undefined;

  return (
    <RegisterCancel.Provider value={(el) => (cancel = el)}>
      <KAlertDialog.Portal>
        <KAlertDialog.Overlay
          class={cn(
            "fixed inset-0 z-overlay bg-black/40 backdrop-blur-[1px] dark:bg-black/60",
            "data-[expanded]:animate-in data-[expanded]:fade-in-0",
            "data-[closed]:animate-out data-[closed]:fade-out-0"
          )}
        />
        <div class="fixed inset-0 z-overlay flex items-center justify-center p-4">
          <KAlertDialog.Content
            onOpenAutoFocus={(event) => {
              // Kobalte would focus the first tabbable node, which is the
              // action. See the note at the top of the file.
              if (!cancel) return;
              event.preventDefault();
              cancel.focus();
            }}
            class={cn(
              // The modal stack, which already carries its own 1px ring. No
              // border here, or the hairline doubles and the panel shifts.
              "bg-popover text-popover-foreground w-full max-w-md rounded-md",
              "shadow-modal outline-none",
              "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
              "data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
              local.class
            )}
            {...rest}
          >
            {local.children}
          </KAlertDialog.Content>
        </div>
      </KAlertDialog.Portal>
    </RegisterCancel.Provider>
  );
}

export function AlertDialogHeader(props: { class?: string; children?: JSX.Element }) {
  return <div class={cn("flex flex-col gap-1 px-5 pt-5 pb-4", props.class)}>{props.children}</div>;
}

export function AlertDialogTitle(
  props: ComponentProps<typeof KAlertDialog.Title> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  // 16/24/600 at -0.02em, matching DialogTitle. See the note there.
  return <KAlertDialog.Title class={cn("text-lead", local.class)} {...rest} />;
}

export function AlertDialogDescription(
  props: ComponentProps<typeof KAlertDialog.Description> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.Description
      class={cn("text-body text-muted-foreground", local.class)}
      {...rest}
    />
  );
}

export function AlertDialogFooter(props: { class?: string; children?: JSX.Element }) {
  return (
    <div
      class={cn(
        "flex items-center justify-end gap-2 border-t border-border px-5 py-4",
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

export interface AlertDialogActionProps extends Omit<ComponentProps<"button">, "type"> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  type?: "button" | "submit" | "reset";
}

/**
 * The action does not close the dialog. Whatever it runs is usually a request,
 * and a dialog that vanishes on click has already told the user it worked.
 * Close it when the work is done -- `ConfirmDelete` below is that shape.
 *
 * `type="button"` is deliberate and comes before the spread so a caller can
 * still pass `type="submit"`: this button lives in a portal, so a form around
 * the trigger is not its form anyway.
 */
export function AlertDialogAction(props: AlertDialogActionProps) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <Button
      type="button"
      variant={local.variant ?? "destructive"}
      class={local.class}
      {...rest}
    />
  );
}

export function AlertDialogCancel(
  props: ComponentProps<typeof KAlertDialog.CloseButton> & { class?: string }
) {
  const register = useContext(RegisterCancel);
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KAlertDialog.CloseButton
      ref={(el: HTMLElement) => register?.(el)}
      class={cn(buttonVariants({ variant: "outline" }), local.class)}
      {...rest}
    />
  );
}

export interface ConfirmDeleteProps {
  trigger: JSX.Element;
  title: string;
  description: JSX.Element;
  /** When set, the action stays disabled until the typed text matches exactly. */
  confirmWord?: string;
  actionLabel?: string;
  onConfirm: () => void | Promise<void>;
}

/**
 * Delete a workspace, a project, a source, a dashboard.
 *
 * This exists so those four call sites do not each re-derive the same four
 * pieces of state -- open, typed, armed, in flight -- and get one of them
 * subtly wrong.
 */
export function ConfirmDelete(props: ConfirmDeleteProps): JSX.Element {
  const i18n = useI18n();
  const [open, setOpen] = createSignal(false);
  const [typed, setTyped] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // Trimmed because a trailing space from a paste is not a different answer,
  // case-sensitive because the whole point of typing the name is having read it.
  const armed = () => !props.confirmWord || typed().trim() === props.confirmWord;

  async function confirm() {
    if (!armed() || busy()) return;
    setBusy(true);
    try {
      await props.onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open()}
      onOpenChange={(next) => {
        // Nothing closes this while the delete is in flight -- not Escape, not
        // the overlay, not Cancel -- because the row being deleted is still on
        // screen behind it and would look untouched.
        if (busy()) return;
        setTyped("");
        setOpen(next);
      }}
    >
      {/*
        The caller hands in a whole element, usually a Button, so this cannot be
        Kobalte's Trigger -- that would render a second button around the first.
        A click listener is enough: keyboard activation of the caller's button
        fires a click too, and `open` is controlled from here anyway.
      */}
      <span class="contents" onClick={() => setOpen(true)}>
        {props.trigger}
      </span>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>

        <Show when={props.confirmWord}>
          {(word) => (
            <div class="px-5 pb-4">
              {/*
                Two keys around the word, which is the one place in this file a
                sentence is built from fragments. The word has to be set in mono
                at full contrast -- the point of typing a name is that you read
                it character by character first -- and a placeholder cannot
                carry markup. Both halves are whole clauses in both languages:
                "Geben Sie <name> zur Bestätigung ein."
              */}
              <Field
                label={
                  <>
                    {i18n.t("ui.confirm_type_prefix")}{" "}
                    <span class="font-mono text-mono font-semibold text-foreground">{word()}</span>{" "}
                    {i18n.t("ui.confirm_type_suffix")}
                  </>
                }
              >
                <Input
                  value={typed()}
                  onInput={(event) => setTyped(event.currentTarget.value)}
                  disabled={busy()}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                />
              </Field>
            </div>
          )}
        </Show>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy()}>{i18n.t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={busy() || !armed()} onClick={confirm}>
            <Show when={busy()}>
              <Spinner />
            </Show>
            {props.actionLabel ?? i18n.t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
