import { ColumnHeightOutlined, RightOutlined, VerticalAlignMiddleOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { ReactNode } from "react";
import { z } from "zod";
import { usePersistentState } from "../hooks/usePersistentState";

/**
 * Collapsed section ids for one page, persisted across sessions. Returns
 * the props every `Section` needs plus the collapse/expand-all control.
 */
export function useSections(storageKey: string, ids: readonly string[]) {
  const [closed, setClosed] = usePersistentState(storageKey, z.array(z.string()), []);
  const toggle = (id: string) =>
    setClosed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allClosed = ids.every((id) => closed.includes(id));
  const toggleAll = () => setClosed(allClosed ? [] : [...ids]);
  return { section: { closed, onToggle: toggle }, allClosed, toggleAll };
}

export function CollapseAllButton({ allClosed, onClick }: { allClosed: boolean; onClick: () => void }) {
  return (
    <Button
      size="small"
      icon={allClosed ? <ColumnHeightOutlined /> : <VerticalAlignMiddleOutlined />}
      onClick={onClick}
    >
      {allClosed ? "Expand all" : "Collapse all"}
    </Button>
  );
}

type SectionProps = {
  id: string;
  title: ReactNode;
  /** Rendered after the title; clicks inside do not toggle the section. */
  extra?: ReactNode;
  closed: string[];
  onToggle: (id: string) => void;
  children: ReactNode;
};

/** Card with a clickable header that folds its body. */
export function Section({ id, title, extra, closed, onToggle, children }: SectionProps) {
  const open = !closed.includes(id);
  return (
    <div className="card">
      <div className={`card-head${open ? "" : " closed"}`}>
        <button type="button" className="sec-head" aria-expanded={open} onClick={() => onToggle(id)}>
          <RightOutlined className="sec-chev" rotate={open ? 90 : 0} />
          <h3 className="section-title">{title}</h3>
        </button>
        {extra}
      </div>
      {open ? children : null}
    </div>
  );
}
