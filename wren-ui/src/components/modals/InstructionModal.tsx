import { useEffect } from 'react';
import { Button, Form, Input, Modal, Row, Col, Radio } from 'antd';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { isEmpty } from 'lodash';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import { Instruction } from '@/apollo/client/graphql/__types__';

const MAX_QUESTIONS = 100;

type Props = ModalAction<Instruction> & {
  loading?: boolean;
};

export default function InstructionModal(props: Props) {
  const { defaultValue, formMode, loading, onClose, onSubmit, visible } = props;

  const isCreateMode = formMode === FORM_MODE.CREATE;

  const [form] = Form.useForm();
  const isDefault = Form.useWatch('isDefault', form);

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        isDefault: isEmpty(defaultValue) ? true : defaultValue.isDefault,
        instruction: defaultValue?.instruction,
        questions: defaultValue?.questions,
      });
    }
  }, [visible, defaultValue]);

  const onSubmitButton = () => {
    form
      .validateFields()
      .then(async (values) => {
        const data = {
          isDefault: values.isDefault,
          instruction: values.instruction,
          questions: values?.questions || [],
        };
        await onSubmit({ data, id: defaultValue?.id });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title={`${isCreateMode ? '新增' : '编辑'}指令`}
      centered
      closable
      confirmLoading={loading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      visible={visible}
      width={720}
      cancelButtonProps={{ disabled: loading }}
      okText="提交"
      onOk={onSubmitButton}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label="指令内容"
          name="instruction"
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.INSTRUCTION.DETAILS.REQUIRED,
            },
          ]}
        >
          <Input.TextArea
            autoFocus
            placeholder="请输入 Zen-SmartBI 在生成 SQL 时应遵循的规则。"
            maxLength={1000}
            rows={3}
            showCount
          />
        </Form.Item>
        <Form.Item
          label="指令适用范围"
          name="isDefault"
          required={false}
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.INSTRUCTION.IS_DEFAULT_GLOBAL.REQUIRED,
            },
          ]}
          extra={
            <>
              请选择该指令适用于
              <span className="gray-7">所有查询</span>
              或仅在
              <span className="gray-7">检测到相似用户问题时</span>
              生效。
            </>
          }
        >
          <Radio.Group>
            <Radio.Button value={true}>全局（适用于所有问题）</Radio.Button>
            <Radio.Button value={false}>仅匹配特定问题</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {!isDefault && (
          <Form.Item
            label="匹配问题"
            required
            extra="Zen-SmartBI 会基于相似度匹配用户问题，并在相关时应用该指令。"
          >
            <Form.List name="questions" initialValue={['']}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} wrap={false} gutter={8} className="my-2">
                      <Col flex="1 0">
                        <Form.Item
                          {...restField}
                          name={name}
                          required
                          className="mb-2"
                          style={{ width: '100%' }}
                          rules={[
                            {
                              required: true,
                              whitespace: true,
                              message:
                                ERROR_TEXTS.INSTRUCTION.QUESTIONS.REQUIRED,
                            },
                          ]}
                        >
                          <Input
                            placeholder="请输入可触发该指令的示例问题。"
                            maxLength={100}
                            showCount
                          />
                        </Form.Item>
                      </Col>
                      <Col flex="none" className="p-1">
                        <Button
                          onClick={() => remove(name)}
                          disabled={fields.length <= 1}
                          icon={<DeleteOutlined />}
                          size="small"
                          style={{ border: 'none' }}
                          className="bg-gray-1"
                        />
                      </Col>
                    </Row>
                  ))}
                  <Form.Item noStyle>
                    <Button
                      type="dashed"
                      onClick={() => add()}
                      block
                      icon={<PlusOutlined />}
                      disabled={fields.length >= MAX_QUESTIONS}
                      className="mb-1"
                    >
                      新增问题
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
