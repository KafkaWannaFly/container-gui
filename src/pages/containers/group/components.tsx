import { ColumnHeightOutlined, DownOutlined, VerticalAlignMiddleOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown } from "antd";
import { useState } from "react";
import type { ContainerSummary } from "../../../types/docker";

/** "Containers ▾" chip with a checklist, shared by the Logs and Monitor tabs.
 * `hidden` holds the ids that are filtered out. */
export function ContainerFilter({
  containers,
  hidden,
  setHidden,
  nameOf,
  colorOf,
}: {
  containers: ContainerSummary[];
  hidden: string[];
  setHidden: (ids: string[]) => void;
  nameOf: (ctr: ContainerSummary) => string;
  colorOf: (ctr: ContainerSummary) => string;
}) {
  const shown = containers.filter((ctr) => !hidden.includes(ctr.id));
  const toggle = (id: string) =>
    setHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
  const only = (id: string) => setHidden(containers.filter((ctr) => ctr.id !== id).map((ctr) => ctr.id));

  return (
    <>
      <Dropdown
        trigger={["click"]}
        placement="bottomLeft"
        popupRender={() => (
          <div
            style={{
              background: "var(--obsidian)",
              border: "1px solid var(--graphite)",
              borderRadius: 8,
              padding: 4,
              minWidth: 280,
            }}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: dropdown row toggles a checkbox */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: dropdown row toggles a checkbox */}
            <div
              className="g-inactive-row"
              onClick={() => setHidden(hidden.length === 0 ? containers.map((ctr) => ctr.id) : [])}
            >
              <Checkbox
                tabIndex={-1}
                checked={hidden.length === 0}
                indeterminate={hidden.length > 0 && shown.length > 0}
              />
              <span>All containers</span>
              <span className="n mono" style={{ marginLeft: "auto", color: "var(--ash)" }}>
                {shown.length} / {containers.length}
              </span>
            </div>
            {containers.map((ctr) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: dropdown row toggles a checkbox
              // biome-ignore lint/a11y/useKeyWithClickEvents: dropdown row toggles a checkbox
              <div key={ctr.id} className="g-inactive-row" onClick={() => toggle(ctr.id)}>
                <Checkbox tabIndex={-1} checked={!hidden.includes(ctr.id)} />
                <span style={{ width: 8, height: 8, borderRadius: 99, background: colorOf(ctr) }} />
                <span>{nameOf(ctr)}</span>
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginLeft: "auto", fontSize: 12 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    only(ctr.id);
                  }}
                >
                  only
                </button>
              </div>
            ))}
          </div>
        )}
      >
        <span className="g-chip">
          <span className="dots">
            {shown.map((ctr) => (
              <i key={ctr.id} style={{ background: colorOf(ctr) }} />
            ))}
          </span>
          Containers
          <span className="n mono">
            {shown.length === containers.length ? "all" : `${shown.length} / ${containers.length}`}
          </span>
          <DownOutlined style={{ fontSize: 10, color: "var(--smoke)" }} />
        </span>
      </Dropdown>
      {hidden.length > 0 ? (
        <Button type="text" size="small" onClick={() => setHidden([])}>
          Show all
        </Button>
      ) : null}
    </>
  );
}

export { Section } from "../../../components/Section";

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
