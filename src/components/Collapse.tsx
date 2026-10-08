import { AnimatePresence, motion, type Transition, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const EASE: Transition["ease"] = [0.22, 1, 0.36, 1];

/** Shared timing for every fold animation; instant when the OS asks for reduced motion. */
export function useCollapseTransition(): Transition {
  const reduce = useReducedMotion();
  return reduce
    ? { duration: 0 }
    : { default: { duration: 0.28, ease: EASE }, opacity: { duration: 0.2, ease: "easeOut" } };
}

type CollapseProps = {
  open: boolean;
  children: ReactNode;
  /** Animate on first render too; off by default so pages don't unfold on load. */
  animateOnMount?: boolean;
  className?: string;
};

/**
 * Smoothly folds its children by animating height between 0 and `auto`.
 * Children unmount once closed, matching the previous `open ? children : null`.
 */
export function Collapse({ open, children, animateOnMount = false, className }: CollapseProps) {
  const transition = useCollapseTransition();

  return (
    <AnimatePresence initial={animateOnMount}>
      {open ? (
        <motion.div
          key="collapse"
          className={className}
          initial={{ height: 0, opacity: 0, overflow: "hidden" }}
          // Clip only while moving so focus rings and shadows aren't cut off at rest.
          animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
          exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          transition={transition}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
