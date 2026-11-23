import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { SwipeToReveal, type SwipeToRevealAction } from "@wearables-ui-toolkit/mrbd";

type Props = {
  actions: readonly [SwipeToRevealAction, SwipeToRevealAction?, SwipeToRevealAction?];
  children: ReactElement;
  /** Fired when the user swipes/arrows right — e.g. return to Translate. */
  onNavigateRight?: () => void;
  actionsShownAnnouncement?: string;
  actionsHiddenAnnouncement?: string;
};

function trayIsOpen(root: EventTarget | null): boolean {
  if (!(root instanceof HTMLElement)) return false;
  return Array.from(root.children).some(
    (child) =>
      child instanceof HTMLElement &&
      child.getAttribute("aria-hidden") === "false",
  );
}

/**
 * Toolkit SwipeToReveal opens on ArrowRight by default, which fights the pager.
 * Remap: ArrowLeft reveals Delete; ArrowRight navigates (does not reveal).
 */
export function SwipeToDelete({
  actions,
  children,
  onNavigateRight,
  actionsShownAnnouncement = "Delete available",
  actionsHiddenAnnouncement = "Delete hidden",
}: Props) {
  const allowToolkitReveal = useRef(false);

  const dispatchArrowRight = useCallback((root: EventTarget, type: "keydown" | "keyup") => {
    if (!(root instanceof HTMLElement)) return;
    root.dispatchEvent(
      new KeyboardEvent(type, {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  }, []);

  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const open = trayIsOpen(event.currentTarget);

      if (event.key === "ArrowRight" && !open && !allowToolkitReveal.current) {
        event.preventDefault();
        event.stopPropagation();
        onNavigateRight?.();
        return;
      }

      if (event.key === "ArrowLeft" && !open) {
        event.preventDefault();
        event.stopPropagation();
        allowToolkitReveal.current = true;
        dispatchArrowRight(event.currentTarget, "keydown");
      }
    },
    [dispatchArrowRight, onNavigateRight],
  );

  const onKeyUpCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const open = trayIsOpen(event.currentTarget);

      if (event.key === "ArrowRight" && !allowToolkitReveal.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "ArrowLeft" && !open && allowToolkitReveal.current) {
        event.preventDefault();
        event.stopPropagation();
        dispatchArrowRight(event.currentTarget, "keyup");
        queueMicrotask(() => {
          allowToolkitReveal.current = false;
        });
        return;
      }

      if (event.key === "ArrowRight" && allowToolkitReveal.current) {
        queueMicrotask(() => {
          allowToolkitReveal.current = false;
        });
      }
    },
    [dispatchArrowRight],
  );

  return (
    <SwipeToReveal
      actions={actions}
      actionsShownAnnouncement={actionsShownAnnouncement}
      actionsHiddenAnnouncement={actionsHiddenAnnouncement}
      onKeyDownCapture={onKeyDownCapture}
      onKeyUpCapture={onKeyUpCapture}
    >
      {children}
    </SwipeToReveal>
  );
}
