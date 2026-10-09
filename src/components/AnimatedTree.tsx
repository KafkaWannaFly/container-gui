import { CaretRightOutlined } from "@ant-design/icons";
import type { TableProps } from "antd";
import { type HTMLMotionProps, motion } from "motion/react";
import {
  createContext,
  type Dispatch,
  type HTMLAttributes,
  type Key,
  type SetStateAction,
  type TdHTMLAttributes,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCollapseTransition } from "./Collapse";

/*
 * Animated expand/collapse for antd tree tables (rows with `children`).
 *
 * A `<tr>` can't animate its height, so each child cell wraps its content in
 * a motion div that folds between 0 and `auto`. antd unmounts child rows the
 * moment a group collapses, so a closing group stays in `expandedRowKeys`
 * until its rows finish folding.
 */

type RowAnim = {
  open: boolean;
  /** Mounted by a user expand, so unfold from 0 instead of appearing open. */
  animateIn: boolean;
  onDone: (open: boolean) => void;
};

const RowAnimContext = createContext<RowAnim | null>(null);

type TreeRowProps = HTMLAttributes<HTMLTableRowElement> & { treeAnim?: RowAnim };

function TreeRow({ treeAnim, ...props }: TreeRowProps) {
  if (!treeAnim) return <tr {...props} />;
  return (
    <RowAnimContext.Provider value={treeAnim}>
      <tr {...props} />
    </RowAnimContext.Provider>
  );
}

const HIDDEN = { height: 0, opacity: 0, overflow: "hidden" } as const;
// Clip only while moving so focus rings and popovers aren't cut off at rest.
const SHOWN = { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } } as const;

function TreeCell({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  const anim = useContext(RowAnimContext);
  const transition = useCollapseTransition();
  if (!anim) {
    return (
      <td className={className} {...props}>
        {children}
      </td>
    );
  }
  const { open, animateIn, onDone } = anim;
  return (
    <motion.td
      {...(props as HTMLMotionProps<"td">)}
      className={className ? `${className} tt-cell` : "tt-cell"}
      initial={animateIn ? { borderBottomWidth: 0 } : false}
      animate={{ borderBottomWidth: open ? 1 : 0 }}
      transition={transition}
    >
      <motion.div
        initial={animateIn ? HIDDEN : false}
        animate={open ? SHOWN : HIDDEN}
        transition={transition}
        onAnimationComplete={() => onDone(open)}
      >
        <div className="tt-cell-inner">{children}</div>
      </motion.div>
    </motion.td>
  );
}

const TREE_COMPONENTS = { body: { row: TreeRow, cell: TreeCell } };

function childrenOf<T>(row: T): readonly T[] {
  const children = (row as { children?: readonly T[] }).children;
  return Array.isArray(children) ? children : [];
}

/**
 * Props to spread onto an antd `<Table>` whose groups should fold smoothly.
 * `expanded` stays owned by the page (it auto-expands new groups).
 */
export function useAnimatedTree<T extends { key: Key }>({
  data,
  expanded,
  setExpanded,
  isGroup,
}: {
  data: readonly T[];
  expanded: Key[];
  setExpanded: Dispatch<SetStateAction<Key[]>>;
  isGroup: (row: T) => boolean;
}) {
  const [closing, setClosing] = useState<Key[]>([]);
  const opening = useRef(new Set<Key>());

  const parentOf = useMemo(() => {
    const map = new Map<Key, Key>();
    for (const row of data) for (const child of childrenOf(row)) map.set(child.key, row.key);
    return map;
  }, [data]);

  // A group that vanishes mid-fold never reports completion; drop it.
  useEffect(() => {
    const groups = new Set(parentOf.values());
    setClosing((prev) =>
      prev.every((key) => groups.has(key)) ? prev : prev.filter((key) => groups.has(key)),
    );
  }, [parentOf]);

  // One caret or the whole table share this bookkeeping.
  const setOpen = (keys: Key[], open: boolean) => {
    const targets = keys.filter((key) => expanded.includes(key) !== open);
    if (targets.length === 0) return;
    if (open) {
      for (const key of targets) {
        // Still mounted while closing: those rows just reverse, no mount animation.
        if (!closing.includes(key)) opening.current.add(key);
      }
      setClosing((prev) => prev.filter((key) => !targets.includes(key)));
      setExpanded((prev) => [...prev, ...targets.filter((key) => !prev.includes(key))]);
    } else {
      for (const key of targets) opening.current.delete(key);
      setClosing((prev) => [...prev, ...targets.filter((key) => !prev.includes(key))]);
      setExpanded((prev) => prev.filter((key) => !targets.includes(key)));
    }
  };

  const toggle = (key: Key) => setOpen([key], !expanded.includes(key));

  const groupKeys = data.filter(isGroup).map((row) => row.key);
  const allExpanded = groupKeys.length > 0 && groupKeys.every((key) => expanded.includes(key));
  const toggleAll = () => setOpen(groupKeys, !allExpanded);

  const finish = (key: Key, open: boolean) => {
    if (open) {
      opening.current.delete(key);
      return;
    }
    setClosing((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev));
  };

  const expandable: TableProps<T>["expandable"] = {
    expandedRowKeys: [...expanded, ...closing],
    rowExpandable: isGroup,
    indentSize: 20,
    expandIcon: ({ record }) =>
      isGroup(record) ? (
        <CaretRightOutlined
          onClick={(event) => {
            event.stopPropagation();
            toggle(record.key);
          }}
          style={{
            cursor: "pointer",
            fontSize: 12,
            color: "var(--fog)",
            marginRight: 2,
            transform: expanded.includes(record.key) ? "rotate(90deg)" : "none",
            transition: "transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      ) : null,
  };

  const onRow = (record: T) => {
    const parent = parentOf.get(record.key);
    if (parent === undefined) return {};
    const treeAnim: RowAnim = {
      open: expanded.includes(parent),
      animateIn: opening.current.has(parent),
      onDone: (open) => finish(parent, open),
    };
    // antd forwards onRow's result to the custom row component as props.
    return { treeAnim } as HTMLAttributes<HTMLElement>;
  };

  return {
    expandable,
    components: TREE_COMPONENTS,
    onRow,
    allExpanded,
    hasGroups: groupKeys.length > 0,
    toggleAll,
  };
}
