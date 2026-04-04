import { Button, Typography, Timeline } from 'antd';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import ToolOutlined from '@ant-design/icons/ToolOutlined';
import useModalAction from '@/hooks/useModalAction';
import ErrorCollapse from '@/components/ErrorCollapse';
import { FixSQLModal } from '@/components/modals/FixSQLModal';
import { Error } from '@/apollo/client/graphql/__types__';

export interface Props {
  children: React.ReactNode;
  error?: Error & {
    invalidSql?: string;
    fixStatement?: (sql: string) => Promise<void>;
    fixStatementLoading?: boolean;
  };
}

export default function ErrorBoundary({ children, error }: Props) {
  const fixItModal = useModalAction();
  if (!error) return <>{children}</>;
  const hasInvalidSql = !!error.invalidSql;
  return (
    <Timeline className="px-1 -mb-4">
      <Timeline.Item dot={<CloseCircleFilled className="red-5" />}>
        <Typography.Text className="gray-8">
          {hasInvalidSql
            ? 'SQL 语句生成失败'
            : error.shortMessage}
        </Typography.Text>
        <div className="gray-7 text-sm mt-1">
          <div>
            {hasInvalidSql
              ? '系统已尝试根据你的问题生成 SQL，但遇到了一点问题。请协助修复。'
              : error.message}
          </div>
          {hasInvalidSql && (
            <>
              <div className="bg-gray-2 p-2 my-4">
                <ErrorCollapse message={error.message} defaultActive />
              </div>
              <Button
                className="mt-2 adm-fix-it-btn"
                icon={<ToolOutlined />}
                size="small"
                onClick={() => fixItModal.openModal({ sql: error.invalidSql })}
              >
                修复
              </Button>
              <FixSQLModal
                {...fixItModal.state}
                loading={error.fixStatementLoading}
                onClose={fixItModal.closeModal}
                onSubmit={async (sql: string) => {
                  await error.fixStatement(sql);
                }}
              />
            </>
          )}
        </div>
      </Timeline.Item>
    </Timeline>
  );
}
