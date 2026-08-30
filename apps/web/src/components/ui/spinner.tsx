import Loader from "lucide-solid/icons/loader-circle";
import { cn } from "../../lib/cn.js";

export function Spinner(props: { class?: string }) {
  return (
    <Loader class={cn("size-4 animate-spin", props.class)} aria-hidden="true" />
  );
}
