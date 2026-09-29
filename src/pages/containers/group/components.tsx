import { ColumnHeightOutlined, RightOutlined, VerticalAlignMiddleOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { type ReactNode, useState } from "react";

/** Collapsible card used by every group tab. */
export function Section({
  id,
  title,
  extra,
  closed,
  onToggle,
  children,
}: {
  id: string;
  title: ReactNode;
  extra?: ReactNode;
  closed: string[];
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  const open = !closed.includes(id);
  return (
    <div className="card">
      <div className={`card-head${open ? "" : " closed"}`}>
        <button
          type="button"
          className="sec-head"
          aria-expanded={open}
          onClick={() => onToggle(id)}
        >
          <RightOutlined className="sec-chev" rotate={open ? 90 : 0} />
          <h3 className="section-title">{title}</h3>
        </button>
        {extra}
      </div>
      {open ? children : null}
    </div>
  );
}

export function useSections(ids: string[]) {
  const [closed, setClosed] = useState<string[]>([]);
  const toggle = (id: string) =>
    setClosed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allClosed = ids.every((id) => closed.includes(id));
  const button = (
    <Button
      size="small"
      icon={allClosed ? <ColumnHeightOutlined /> : <VerticalAlignMiddleOutlined />}
      onClick={() => setClosed(allClosed ? [] : ids)}
    >
      {allClosed ? "Expand all" : "Collapse all"}
    </Button>
  );
  return { closed, onToggle: toggle, button };
}
