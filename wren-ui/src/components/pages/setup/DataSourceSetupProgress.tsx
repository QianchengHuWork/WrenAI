import { Alert, Typography } from 'antd';
import styled from 'styled-components';
import type { DataSourceSetupProgress as DataSourceSetupProgressState } from '@/hooks/useSetupConnectionDataSource';

const Wrapper = styled.div`
  border: 1px solid var(--gray-4);
  border-radius: 8px;
  background: var(--gray-1);
`;

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const StepRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-start;
`;

const StepDot = styled.div<{ $status: string }>`
  width: 10px;
  height: 10px;
  border-radius: 999px;
  margin-top: 7px;
  flex-shrink: 0;
  background: ${({ $status }) => {
    if ($status === 'COMPLETED') return 'var(--green-6)';
    if ($status === 'RUNNING') return 'var(--geekblue-6)';
    if ($status === 'FAILED') return 'var(--red-5)';
    return 'var(--gray-5)';
  }};
`;

type Props = {
  progress?: DataSourceSetupProgressState | null;
  title?: string;
  subtitle?: string;
  hideWhenCompleted?: boolean;
  errorTitle?: string;
};

export default function DataSourceSetupProgress({
  progress,
  title,
  subtitle,
  hideWhenCompleted = false,
  errorTitle = '创建失败',
}: Props) {
  if (
    !progress ||
    progress.status === 'IDLE' ||
    (hideWhenCompleted && progress.status === 'COMPLETED')
  ) {
    return null;
  }

  return (
    <Wrapper className="p-5 mt-6">
      <Typography.Title level={5} className="mb-2">
        {title || '正在预加载并创建数据源'}
      </Typography.Title>
      {subtitle ? (
        <Typography.Text className="gray-7 d-block mb-4">
          {subtitle}
        </Typography.Text>
      ) : null}

      <StepList>
        {progress.steps.map((step, index) => (
          <StepRow key={step.key}>
            <StepDot $status={step.status} />
            <div>
              <Typography.Text strong className="gray-8">
                {index + 1}. {step.title}
              </Typography.Text>
              {step.description ? (
                <Typography.Text className="gray-7 d-block mt-1">
                  {step.description}
                </Typography.Text>
              ) : null}
            </div>
          </StepRow>
        ))}
      </StepList>

      {progress.error ? (
        <Alert
          className="mt-4"
          type="error"
          showIcon
          message={errorTitle}
          description={progress.error}
        />
      ) : null}
    </Wrapper>
  );
}
