import Link from 'next/link';
import { Button, Col, Form, Row, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ERROR_TEXTS } from '@/utils/error';
import MultiSelectBox from '@/components/table/MultiSelectBox';
import { CompactTable } from '@/apollo/client/graphql/__types__';

const { Title, Text } = Typography;

interface Props {
  fetching: boolean;
  tables: CompactTable[];
  onNext: (data: { selectedTables: string[] }) => void;
  onBack: () => void;
  submitting: boolean;
}

const columns: ColumnsType<CompactTable> = [
  {
    title: '表名',
    dataIndex: 'name',
  },
];

export default function SelectModels(props: Props) {
  const { fetching, tables, onBack, onNext, submitting } = props;
  const [form] = Form.useForm();

  const items = tables.map((item) => ({
    ...item,
    value: item.name,
  }));

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ selectedTables: values.tables });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <div>
      <Title level={1} className="mb-3">
        选择要用于创建数据模型的表
      </Title>
      <Text>
        我们会基于所选表创建数据模型，帮助 AI 更好地理解你的数据。
        <br />
        <Link
          href="https://docs.getwren.ai/oss/guide/modeling/overview"
          target="_blank"
          rel="noopener noreferrer"
        >
          了解更多
        </Link>{' '}
        关于数据模型的信息。
      </Text>
      <div className="my-6">
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="tables"
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SETUP_MODEL.TABLE.REQUIRED,
              },
            ]}
          >
            <MultiSelectBox
              columns={columns}
              items={items}
              loading={fetching}
            />
          </Form.Item>
        </Form>
      </div>
      <Row gutter={16} className="pt-6">
        <Col span={12}>
          <Button
            onClick={onBack}
            size="large"
            className="adm-onboarding-btn"
            disabled={submitting}
          >
            上一步
          </Button>
        </Col>
        <Col className="text-right" span={12}>
          <Button
            type="primary"
            size="large"
            onClick={submit}
            className="adm-onboarding-btn"
            loading={submitting}
          >
            下一步
          </Button>
        </Col>
      </Row>
    </div>
  );
}
