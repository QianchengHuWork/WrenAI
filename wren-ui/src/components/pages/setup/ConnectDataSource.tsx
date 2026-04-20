import Image from 'next/image';
import Link from 'next/link';
import { Alert, Typography, Form, Row, Col, Button } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import type { DataSourceSetupProgress as DataSourceSetupProgressState } from '@/hooks/useSetupConnectionDataSource';
import { getDataSource, getPostgresErrorMessage } from './utils';
import DataSourceSetupProgress from './DataSourceSetupProgress';

const StyledForm = styled(Form)`
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
`;

const DataSource = styled.div`
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
`;

interface Props {
  dataSource: DATA_SOURCES;
  onNext: (data: any) => void;
  onBack: () => void;
  submitting: boolean;
  connectError?: Record<string, any>;
  setupProgress?: DataSourceSetupProgressState;
}

export default function ConnectDataSource(props: Props) {
  const {
    connectError,
    dataSource,
    submitting,
    onNext,
    onBack,
    setupProgress,
  } = props;
  const [form] = Form.useForm();
  const current = getDataSource(dataSource);

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ properties: values });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <>
      <Typography.Title level={1} className="mb-3">
        连接数据源
      </Typography.Title>
      <Typography.Text>
        你也可以在{' '}
        <Link
          href="https://github.com/Canner/WrenAI/discussions/327"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </Link>
        为你希望支持的数据源投票。
      </Typography.Text>

      <StyledForm form={form} layout="vertical" className="p-6 my-6">
        <Row align="middle" className="mb-6">
          <Col span={12}>
            <DataSource className="d-inline-block px-4 py-2 bg-gray-2 gray-8">
              <Image
                className="mr-2"
                src={current.logo}
                alt={dataSource}
                width="40"
                height="40"
              />
              {current.label}
            </DataSource>
          </Col>
          <Col className="text-right" span={12}>
            查看 {current.label} 的更多信息，请参考{' '}
            <Link
              href={current.guide}
              target="_blank"
              rel="noopener noreferrer"
            >
              接入指南
            </Link>
            。
          </Col>
        </Row>
        <current.component />
      </StyledForm>

      {dataSource === DATA_SOURCES.DENODO_MCP && setupProgress ? (
        <DataSourceSetupProgress
          progress={setupProgress}
          title="正在预加载并创建数据源"
          subtitle="核心语义层会先就绪，Semantic Dictionary 会在后台分步生成并持续更新进度。"
        />
      ) : null}

      {connectError && (
        <Alert
          message={connectError.shortMessage}
          description={
            dataSource === DATA_SOURCES.POSTGRES
              ? getPostgresErrorMessage(connectError)
              : connectError.message
          }
          type="error"
          showIcon
          className="my-6"
        />
      )}

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
            loading={submitting}
            className="adm-onboarding-btn"
          >
            下一步
          </Button>
        </Col>
      </Row>
    </>
  );
}
