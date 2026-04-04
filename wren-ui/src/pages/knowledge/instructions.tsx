import Link from 'next/link';
import {
  Button,
  Tag,
  Table,
  TableColumnsType,
  Typography,
  message,
} from 'antd';
import styled from 'styled-components';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import { InstructionsSVG } from '@/utils/svgs';
import QuestionOutlined from '@ant-design/icons/QuestionOutlined';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { MoreButton } from '@/components/ActionButton';
import { InstructionDropdown } from '@/components/diagram/CustomDropdown';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import GlobalLabel from '@/components/pages/knowledge/GlobalLabel';
import InstructionModal from '@/components/modals/InstructionModal';
import InstructionDrawer from '@/components/pages/knowledge/InstructionDrawer';
import { Instruction } from '@/apollo/client/graphql/__types__';
import {
  useInstructionsQuery,
  useCreateInstructionMutation,
  useUpdateInstructionMutation,
  useDeleteInstructionMutation,
} from '@/apollo/client/graphql/instructions.generated';

const { Paragraph, Text } = Typography;

const StyledQuestionsBlock = styled.div`
  margin: -2px -4px;
`;

const StyledTag = styled(Tag)`
  &.ant-tag.ant-tag {
    display: inline-block;
    margin: 2px 4px;
    max-width: 100%;
  }
`;

const StyledInstructionsIcon = styled(InstructionsSVG)`
  width: 20px;
  height: 20px;
`;

export default function ManageInstructions() {
  const instructionModal = useModalAction();
  const instructionDrawer = useDrawerAction();

  const { data, loading } = useInstructionsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const instructions = data?.instructions || [];

  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
      refetchQueries: ['Instructions'],
      awaitRefetchQueries: true,
      ...options,
    };
  };

  const [createInstructionMutation, { loading: createInstructionLoading }] =
    useCreateInstructionMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('指令创建成功。');
        },
      }),
    );

  const [updateInstructionMutation, { loading: updateInstructionLoading }] =
    useUpdateInstructionMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('指令更新成功。');
        },
      }),
    );

  const [deleteInstructionMutation] = useDeleteInstructionMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('指令删除成功。');
      },
    }),
  );

  const onMoreClick = async (payload) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.DELETE) {
      await deleteInstructionMutation({
        variables: { where: { id: data.id } },
      });
    } else if (type === MORE_ACTION.EDIT) {
      instructionModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_INSTRUCTION) {
      instructionDrawer.openDrawer(data);
    }
  };

  const columns: TableColumnsType<Instruction> = [
    {
      title: '指令内容',
      dataIndex: 'instruction',
      render: (instruction) => (
        <Paragraph title={instruction} ellipsis={{ rows: 3 }}>
          {instruction}
        </Paragraph>
      ),
    },
    {
      title: '匹配问题',
      dataIndex: 'questions',
      width: '50%',
      render: (questions, record) => {
        if (record.isDefault) return <GlobalLabel />;

        const displayQuestions = questions.slice(0, 2);
        const moreCount = questions.length - 2;

        return (
          <StyledQuestionsBlock>
            {displayQuestions.map((question) => (
              <div key={question} className="mb-1">
                <StyledTag className="bg-gray-1 border-gray-5 text-truncate">
                  <QuestionOutlined className="geekblue-6" />
                  <Text className="gray-9" title={question}>
                    {question}
                  </Text>
                </StyledTag>
              </div>
            ))}
            {moreCount > 0 && (
              <div className="text-sm gray-7 pl-1">
                还有 {moreCount} 个问题
              </div>
            )}
          </StyledQuestionsBlock>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 130,
      render: (time) => <Text className="gray-7">{getCompactTime(time)}</Text>,
    },
    {
      key: 'action',
      width: 64,
      align: 'center',
      fixed: 'right',
      render: (_, record) => (
        <InstructionDropdown onMoreClick={onMoreClick} data={record}>
          <MoreButton className="gray-8" />
        </InstructionDropdown>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <PageLayout
        title={
          <>
            <StyledInstructionsIcon className="mr-2 gray-8" />
            管理指令
          </>
        }
        titleExtra={
          <Button type="primary" onClick={() => instructionModal.openModal()}>
            新增指令
          </Button>
        }
        description={
          <>
            你可以在这里管理用于指导 Zen-SmartBI 生成 SQL 的指令。这些指令可帮助
            Zen-SmartBI 理解你的数据模型和业务规则，提升查询准确性，减少手动调整。{' '}
            <Link
              className="gray-8 underline"
              href="https://docs.getwren.ai/oss/guide/knowledge/instructions"
              rel="noopener noreferrer"
              target="_blank"
            >
              了解更多
            </Link>
          </>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={instructions}
          loading={loading}
          columns={columns}
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
          scroll={{ x: 1080 }}
        />
        <InstructionDrawer
          {...instructionDrawer.state}
          onClose={instructionDrawer.closeDrawer}
        />
        <InstructionModal
          {...instructionModal.state}
          onClose={instructionModal.closeModal}
          loading={createInstructionLoading || updateInstructionLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await updateInstructionMutation({
                variables: { where: { id }, data },
              });
            } else {
              await createInstructionMutation({ variables: { data } });
            }
          }}
        />
      </PageLayout>
    </SiderLayout>
  );
}
