import { useQuery } from "@tanstack/react-query";
import { Drawer, Empty, Spin, Table } from "antd";
import { formatDistanceToNow } from "date-fns";
import { Mono } from "../../../components/ui";
import { queryKeys } from "../../../lib/queryClient";
import { imageHistory } from "../../../services/tauriApi";
import { formatBytes } from "../../../types/docker";

interface Props {
  reference: string | null;
  onClose: () => void;
}

export default function LayerHistoryModal({ reference, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.imageHistory(reference ?? ""),
    queryFn: () => imageHistory(reference as string),
    enabled: reference != null,
  });

  const rows = (data ?? []).map((layer, index) => ({ key: index, ...layer }));

  return (
    <Drawer
      open={reference != null}
      onClose={onClose}
      width={680}
      title={
        <span>
          Layer history — <Mono>{reference}</Mono>
        </span>
      }
    >
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
          <Spin />
        </div>
      ) : (
        <Table
          size="small"
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: <Empty description="No layer history" /> }}
          columns={[
            {
              title: "Instruction",
              dataIndex: "createdBy",
              render: (value: string) => <Mono>{value.replace(/^\/bin\/sh -c #\(nop\)\s*/, "") || "—"}</Mono>,
            },
            {
              title: "Created",
              dataIndex: "created",
              width: 130,
              render: (value: number) => (
                <span className="dim">
                  {value ? formatDistanceToNow(new Date(value * 1000), { addSuffix: true }) : "—"}
                </span>
              ),
            },
            {
              title: "Size",
              dataIndex: "size",
              width: 100,
              align: "right",
              render: (value: number) => <span className="mono">{formatBytes(value)}</span>,
            },
          ]}
        />
      )}
    </Drawer>
  );
}
