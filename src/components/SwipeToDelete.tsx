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
 * Toolkit SwipeToReveal only opens when ArrowRight targets a node inside its
 * slot (`slot.contains(event.target)`). Remap ArrowLeft → that reveal path by
 * re-dispatching ArrowRight onto the focused row (not the shell root).
 * ArrowRight is reserved for pager navigation back to Translate.
 */
export function SwipeToDelete({
  actions,
  children,
  onNavigateRight,
  actionsShownAnnouncement = "Delete available",
  actionsHiddenAnnouncement = "Delete hidden",
}: Props) {
  const allowToolkitReveal = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const focusTargetInSlot = useCallback((): HTMLElement | null => {
    const root = rootRef.current;
    if (!root) return null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) {
      return active;
    }
    // Slot is the focusable child's wrapper; prefer a tabindex/role=button inside.
    return (
      root.querySelector<HTMLElement>(
        '[role="button"], [tabindex]:not([tabindex="-1"])',
      ) ?? null
    );
  }, []);

  const dispatchArrowRightOnFocus = useCallback(
    (type: "keydown" | "keyup") => {
      const target = focusTargetInSlot();
      if (!target) return;
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: "ArrowRight",
          code: "ArrowRight",
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    },
    [focusTargetInSlot],
  );

  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const open = trayIsOpen(event.currentTarget);

      // Right → Translate (do not open Delete)
      if (event.key === "ArrowRight" && !open && !allowToolkitReveal.current) {
        event.preventDefault();
        event.stopPropagation();
        onNavigateRight?.();
        return;
      }

      // Left → reveal Delete (item-level wins over pager)
      if (event.key === "ArrowLeft" && !open) {
        event.preventDefault();
        event.stopPropagation();
        allowToolkitReveal.current = true;
        dispatchArrowRightOnFocus("keydown");
      }
    },
    [dispatchArrowRightOnFocus, onNavigateRight],
  );

  const onKeyUpCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const open = trayIsOpen(event.currentTarget);

      if (event.key === "ArrowRight" && !allowToolkitReveal.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "ArrowLeft" && allowToolkitReveal.current && !open) {
        event.preventDefault();
        event.stopPropagation();
        dispatchArrowRightOnFocus("keyup");
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
    [dispatchArrowRightOnFocus],
  );

  return (
    <SwipeToReveal
      ref={rootRef}
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
