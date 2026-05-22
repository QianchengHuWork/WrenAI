import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  TableColumnsType,
  Tag,
  Typography,
  message,
} from 'antd';
import CalculatorOutlined from '@ant-design/icons/CalculatorOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import styled from 'styled-components';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import { getCompactTime } from '@/utils/time';
import type { MetricFormula } from '@/apollo/server/models/metricFormula';

const { Paragraph, Text } = Typography;
const { TextArea } = Input;

const API_PATH = '/api/v1/knowledge/metric-formulas';

interface MetricFormulaListResponse {
  filePath: string;
  formulas: MetricFormula[];
}

interface MetricFormulaFormValues {
  id?: string;
  enabled?: boolean;
  dataSource?: string;
  name?: string;
  description?: string;
  primaryModel?: string;
  requiredModels?: string;
  triggerPhrases?: string;
  exampleQuestions?: string;
  metrics?: Array<{
    name?: string;
    expression?: string;
    description?: string;
  }>;
  forbiddenPatterns?: string;
  extraInstruction?: string;
}

const TagBlock = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const FormulaExpression = styled.pre`
  max-height: 96px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border-radius: 4px;
  background: var(--gray-2);
  color: var(--gray-9);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
`;

const splitLines = (value?: string): string[] =>
  (value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const joinLines = (value?: string[]): string => (value || []).join('\n');

const toFormValues = (formula?: MetricFormula): MetricFormulaFormValues => ({
  id: formula?.id,
  enabled: formula?.enabled ?? true,
  dataSource: formula?.dataSource || 'denodo',
  name: formula?.name,
  description: formula?.description,
  primaryModel: formula?.scope?.primaryModel,
  requiredModels: joinLines(formula?.scope?.requiredModels),
  triggerPhrases: joinLines(formula?.match?.triggerPhrases),
  exampleQuestions: joinLines(formula?.match?.exampleQuestions),
  metrics: formula?.metrics?.length
    ? formula.metrics
    : [{ name: '', expression: '', description: '' }],
  forbiddenPatterns: joinLines(formula?.forbiddenPatterns),
  extraInstruction: formula?.extraInstruction,
});

const toPayload = (
  values: MetricFormulaFormValues,
): Partial<MetricFormula> => ({
  id: values.id,
  enabled: values.enabled !== false,
  dataSource: values.dataSource || 'denodo',
  name: values.name,
  description: values.description,
  scope: {
    primaryModel: values.primaryModel || '',
    requiredModels: splitLines(values.requiredModels),
  },
  match: {
    triggerPhrases: splitLines(values.triggerPhrases),
    exampleQuestions: splitLines(values.exampleQuestions),
  },
  metrics: (values.metrics || [])
    .filter((metric) => metric?.name && metric?.expression)
    .map((metric) => ({
      name: (metric.name || '').trim(),
      expression: (metric.expression || '').trim(),
      ...(metric.description?.trim()
        ? { description: metric.description.trim() }
        : {}),
    })),
  forbiddenPatterns: splitLines(values.forbiddenPatterns),
  extraInstruction: values.extraInstruction,
});

const parseError = async (response: Response) => {
  try {
    const body = await response.json();
    return body?.error || response.statusText;
  } catch {
    return response.statusText;
  }
};

export default function ManageMetricFormulas() {
  const [form] = Form.useForm<MetricFormulaFormValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFormula, setEditingFormula] = useState<MetricFormula | null>(
    null,
  );
  const [data, setData] = useState<MetricFormulaListResponse>({
    filePath: '',
    formulas: [],
  });

  const fetchFormulas = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(API_PATH);
      if (!response.ok) throw new Error(await parseError(response));
      setData(await response.json());
    } catch (error: any) {
      message.error(error.message || '指标公式加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFormulas();
  }, [fetchFormulas]);

  const openModal = (formula?: MetricFormula) => {
    setEditingFormula(formula || null);
    form.setFieldsValue(toFormValues(formula));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingFormula(null);
    form.resetFields();
  };

  const saveFormula = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = toPayload(values);
      const url = editingFormula
        ? `${API_PATH}/${editingFormula.id}`
        : API_PATH;
      const response = await fetch(url, {
        method: editingFormula ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await parseError(response));
      message.success(editingFormula ? '指标公式已更新。' : '指标公式已创建。');
      closeModal();
      await fetchFormulas();
    } catch (error: any) {
      message.error(error.message || '指标公式保存失败。');
    } finally {
      setSaving(false);
    }
  };

  const updateEnabled = async (formula: MetricFormula, enabled: boolean) => {
    try {
      const response = await fetch(`${API_PATH}/${formula.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      message.success(enabled ? '指标公式已启用。' : '指标公式已停用。');
      await fetchFormulas();
    } catch (error: any) {
      message.error(error.message || '状态更新失败。');
    }
  };

  const deleteFormula = (formula: MetricFormula) => {
    Modal.confirm({
      title: '删除指标公式',
      content: `确定删除「${formula.name}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const response = await fetch(`${API_PATH}/${formula.id}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error(await parseError(response));
        message.success('指标公式已删除。');
        await fetchFormulas();
      },
    });
  };

  const columns: TableColumnsType<MetricFormula> = [
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 84,
      render: (enabled, record) => (
        <Switch
          size="small"
          checked={enabled !== false}
          onChange={(checked) => updateEnabled(record, checked)}
        />
      ),
    },
    {
      title: '指标公式',
      dataIndex: 'name',
      width: 240,
      render: (name, record) => (
        <>
          <Paragraph className="mb-1" ellipsis={{ rows: 1 }} title={name}>
            {name}
          </Paragraph>
          <Text className="gray-7 text-sm">{record.id}</Text>
        </>
      ),
    },
    {
      title: '定义域',
      dataIndex: ['scope', 'primaryModel'],
      width: 240,
      render: (primaryModel, record) => (
        <Space direction="vertical" size={4}>
          <Tag color="blue">{primaryModel}</Tag>
          {!!record.scope.requiredModels.length && (
            <Text className="gray-7 text-sm">
              依赖 {record.scope.requiredModels.join(', ')}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '匹配词',
      dataIndex: ['match', 'triggerPhrases'],
      width: 260,
      render: (triggerPhrases: string[]) => (
        <TagBlock>
          {triggerPhrases.slice(0, 4).map((phrase) => (
            <Tag key={phrase}>{phrase}</Tag>
          ))}
          {triggerPhrases.length > 4 && <Tag>+{triggerPhrases.length - 4}</Tag>}
        </TagBlock>
      ),
    },
    {
      title: '公式',
      dataIndex: 'metrics',
      render: (metrics: MetricFormula['metrics']) => (
        <FormulaExpression>
          {metrics
            .map((metric) => `${metric.name}: ${metric.expression}`)
            .join('\n')}
        </FormulaExpression>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 130,
      render: (time) => (
        <Text className="gray-7">{time ? getCompactTime(time) : '-'}</Text>
      ),
    },
    {
      key: 'action',
      width: 116,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openModal(record)}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => deleteFormula(record)}
          />
        </Space>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <PageLayout
        title={
          <>
            <CalculatorOutlined className="mr-2 gray-8" />
            管理指标公式
          </>
        }
        titleExtra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModal()}
          >
            新增指标公式
          </Button>
        }
        description={
          <>
            你可以在这里维护按指标生效的 SQL 计算公式。保存后写入服务端 JSON
            文件，下一次提问会自动带入，不需要重启 AI service。
            {data.filePath && (
              <Text className="gray-7 ml-2">文件：{data.filePath}</Text>
            )}
          </>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={data.formulas}
          loading={loading}
          columns={columns}
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
          scroll={{ x: 1180 }}
        />
        <Modal
          title={editingFormula ? '编辑指标公式' : '新增指标公式'}
          visible={modalOpen}
          width={860}
          okText="保存"
          cancelText="取消"
          confirmLoading={saving}
          onCancel={closeModal}
          onOk={saveFormula}
          destroyOnClose
        >
          <Form
            form={form}
            layout="vertical"
            preserve={false}
            initialValues={toFormValues()}
          >
            <Space align="start" className="w-100">
              <Form.Item
                name="enabled"
                label="启用"
                valuePropName="checked"
                className="mb-0"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name="dataSource"
                label="数据源"
                initialValue="denodo"
                rules={[{ required: true, message: '请输入数据源。' }]}
              >
                <Input placeholder="denodo" />
              </Form.Item>
              <Form.Item
                name="id"
                label="ID"
                rules={[{ required: !editingFormula, message: '请输入 ID。' }]}
              >
                <Input
                  placeholder="denodo_assign_total_conversion"
                  disabled={!!editingFormula}
                />
              </Form.Item>
            </Space>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称。' }]}
            >
              <Input placeholder="智能分配转化指标" />
            </Form.Item>
            <Form.Item name="description" label="描述">
              <TextArea rows={2} />
            </Form.Item>
            <Form.Item
              name="primaryModel"
              label="主模型"
              rules={[{ required: true, message: '请输入主模型。' }]}
            >
              <Input placeholder="dv_assign_total_conversion_core" />
            </Form.Item>
            <Form.Item name="requiredModels" label="依赖模型（每行一个）">
              <TextArea rows={2} />
            </Form.Item>
            <Form.Item name="triggerPhrases" label="触发词（每行一个）">
              <TextArea rows={3} />
            </Form.Item>
            <Form.Item name="exampleQuestions" label="示例问题（每行一个）">
              <TextArea rows={3} />
            </Form.Item>
            <Form.List name="metrics">
              {(fields, { add, remove }) => (
                <>
                  <div className="mb-2">
                    <Text strong>指标表达式</Text>
                    <Button
                      className="ml-2"
                      size="small"
                      onClick={() =>
                        add({ name: '', expression: '', description: '' })
                      }
                    >
                      增加指标
                    </Button>
                  </div>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" className="w-100 mb-2">
                      <Form.Item
                        {...field}
                        name={[field.name, 'name']}
                        rules={[{ required: true, message: '指标名必填。' }]}
                      >
                        <Input
                          style={{ width: 160 }}
                          placeholder="metric_name"
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'expression']}
                        rules={[{ required: true, message: '表达式必填。' }]}
                      >
                        <TextArea
                          style={{ width: 480 }}
                          autoSize={{ minRows: 1, maxRows: 5 }}
                          placeholder='COUNT(DISTINCT "clew_id")'
                        />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                </>
              )}
            </Form.List>
            <Form.Item name="forbiddenPatterns" label="禁用写法（每行一个）">
              <TextArea rows={3} placeholder="COUNT(*)" />
            </Form.Item>
            <Form.Item name="extraInstruction" label="补充指令">
              <TextArea rows={3} />
            </Form.Item>
          </Form>
        </Modal>
      </PageLayout>
    </SiderLayout>
  );
}
