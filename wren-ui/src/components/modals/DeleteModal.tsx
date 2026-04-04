import { ReactNode } from 'react';
import { ButtonProps, Modal, ModalProps } from 'antd';
import ExclamationCircleOutlined from '@ant-design/icons/ExclamationCircleOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';

type DeleteModalProps = {
  disabled?: boolean;
  modalProps?: ModalProps;
  onConfirm: () => void;
  style?: any;
} & Partial<ButtonProps>;

type Config = {
  icon?: ReactNode;
  itemName?: string;
  content?: string;
};

export const makeDeleteModal =
  (Component, config?: Config) => (props: DeleteModalProps) => {
    const { title, content, modalProps = {}, onConfirm, ...restProps } = props;

    return (
      <Component
        icon={config.icon}
        onClick={() =>
          Modal.confirm({
            autoFocusButton: null,
            cancelText: '取消',
            content:
              config?.content ||
              '删除后将无法恢复，请确认是否继续删除。',
            icon: <ExclamationCircleOutlined />,
            okText: '删除',
            onOk: onConfirm,
            title: `确定要删除这个${config?.itemName}吗？`,
            width: 464,
            ...modalProps,
            okButtonProps: {
              ...modalProps.okButtonProps,
              danger: true,
            },
          })
        }
        {...restProps}
      />
    );
  };

const DefaultDeleteButton = (props) => {
  const { icon = null, disabled, ...restProps } = props;
  return (
    <a className={disabled ? '' : 'red-5'} {...restProps}>
      {icon}删除
    </a>
  );
};

export default makeDeleteModal(DefaultDeleteButton);

// Customize delete modal
export const DeleteThreadModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '对话',
  content:
    '该操作会永久删除此对话中的全部历史结果，请确认是否继续。',
});

export const DeleteViewModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '视图',
  content: '删除后将无法恢复，请确认是否继续删除。',
});

export const DeleteModelModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '模型',
  content: '删除后将无法恢复，请确认是否继续删除。',
});

export const DeleteCalculatedFieldModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '计算字段',
  content: '删除后将无法恢复，请确认是否继续删除。',
});

export const DeleteRelationshipModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '关系',
  content: '删除后将无法恢复，请确认是否继续删除。',
});

export const DeleteDashboardItemModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '仪表板卡片',
  content: '删除后将无法恢复，请确认是否继续删除。',
});

export const DeleteQuestionSQLPairModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '问题-SQL 对',
  content:
    '该操作不可撤销，请确认是否继续。',
});

export const DeleteInstructionModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '指令',
  content:
    '该操作不可撤销，请确认是否继续。',
});
