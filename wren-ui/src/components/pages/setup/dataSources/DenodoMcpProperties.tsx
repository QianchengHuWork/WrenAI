import { Form, Input } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';

interface Props {
  mode?: FORM_MODE;
}

export default function DenodoMcpProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  return (
    <>
      <Form.Item
        label="显示名称"
        name="displayName"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        label="MCP 地址"
        name="baseUrl"
        required
        rules={[
          {
            required: true,
            message: '请输入 Denodo MCP 地址',
          },
          {
            type: 'url',
            message: '请输入合法的 MCP 地址',
          },
        ]}
      >
        <Input
          placeholder="https://your-denodo-host/admin/mcp"
          disabled={isEditMode}
        />
      </Form.Item>

      <Form.Item
        label="数据库名称"
        name="databaseName"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input placeholder="admin" disabled={isEditMode} />
      </Form.Item>

      <Form.Item
        label="用户名"
        name="username"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.USERNAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        label="密码"
        name="password"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder="请输入密码" />
      </Form.Item>
    </>
  );
}
