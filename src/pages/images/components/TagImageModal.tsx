import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Form, Input, Modal } from "antd";
import { queryKeys } from "../../../lib/queryClient";
import { tagImage } from "../../../services/tauriApi";

interface Props {
  image: { id: string; repo: string } | null;
  onClose: () => void;
}

interface FormValues {
  repo: string;
  tag: string;
}

export default function TagImageModal({ image, onClose }: Props) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (image) form.setFieldsValue({ repo: image.repo, tag: "latest" });
  }, [image, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => tagImage(image?.id as string, values.repo, values.tag),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
      message.success("Image tagged");
      onClose();
    },
    onError: (err: Error) => message.error(err.message),
  });

  return (
    <Modal
      open={image != null}
      onCancel={onClose}
      title="Tag image"
      okText="Tag"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
        <Form.Item label="Repository" name="repo" rules={[{ required: true, message: "Repository is required" }]}>
          <Input className="mono" placeholder="ghcr.io/acme/worker" />
        </Form.Item>
        <Form.Item label="Tag" name="tag" rules={[{ required: true, message: "Tag is required" }]}>
          <Input className="mono" placeholder="2.4.1" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
