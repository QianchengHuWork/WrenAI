import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect } from 'react';
import styled from 'styled-components';
import { Button, Empty, Typography } from 'antd';
import CodeFilled from '@ant-design/icons/CodeFilled';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import useNativeSQL from '@/hooks/useNativeSQL';
import { DATA_SOURCE_OPTIONS } from '@/components/pages/setup/utils';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import usePromptThreadStore from '@/components/pages/home/promptThread/store';
import PreviewData from '@/components/dataPreview/PreviewData';
import { usePreviewDataMutation } from '@/apollo/client/graphql/home.generated';

const SQLCodeBlock = dynamic(() => import('@/components/code/SQLCodeBlock'), {
  ssr: false,
});

const { Text } = Typography;

const StyledPre = styled.pre`
  .adm_code-block {
    border-top: none;
    border-radius: 0px 0px 4px 4px;
  }
`;

const StyledToolBar = styled.div`
  background-color: var(--gray-2);
  height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--gray-3);
  border-radius: 4px 4px 0px 0px;
`;

export default function ViewSQLTabContent(props: AnswerResultProps) {
  const { isLastThreadResponse, onInitPreviewDone, threadResponse } = props;

  const { onOpenAdjustSQLModal } = usePromptThreadStore();
  const { fetchNativeSQL, nativeSQLResult } = useNativeSQL();
  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });

  const { id, sql } = threadResponse;

  const onPreviewData = async () => {
    await previewData({ variables: { where: { responseId: id } } });
  };

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
    await nextTick();
    onInitPreviewDone();
  };

  // when is the last step of the last thread response, auto trigger preview data button
  useEffect(() => {
    if (isLastThreadResponse) {
      autoTriggerPreviewDataButton();
    }
  }, [isLastThreadResponse]);

  // Auto-fetch native SQL on mount
  useEffect(() => {
    fetchNativeSQL({ variables: { responseId: id } });
  }, [id]);

  const { dataSourceType } = nativeSQLResult;

  // Always show native SQL (data source SQL)
  const sqls =
    nativeSQLResult.loading === false && nativeSQLResult.data
      ? nativeSQLResult.data
      : sql;

  return (
    <div className="text-md gray-10 p-6 pb-4">
      <StyledPre className="p-0 mb-3">
        <StyledToolBar className="d-flex align-center justify-space-between text-family-base">
          <div>
            <Image
              className="mr-2"
              src={DATA_SOURCE_OPTIONS[dataSourceType].logo}
              alt={DATA_SOURCE_OPTIONS[dataSourceType].label}
              width="22"
              height="22"
            />
            <Text className="gray-8 text-medium text-sm">
              {DATA_SOURCE_OPTIONS[dataSourceType].label}
            </Text>
          </div>
          <Button
            type="link"
            data-ph-capture="true"
            data-ph-capture-attribute-name="view_sql_copy_sql"
            icon={<CodeFilled />}
            size="small"
            onClick={() => onOpenAdjustSQLModal({ sql, responseId: id })}
          >
            调整 SQL
          </Button>
        </StyledToolBar>
        <SQLCodeBlock
          code={sqls}
          showLineNumbers
          maxHeight="300"
          loading={nativeSQLResult.loading}
          copyable
        />
      </StyledPre>
      <div className="mt-6">
        <Button
          size="small"
          icon={
            <BinocularsIcon
              style={{
                paddingBottom: 2,
                marginRight: 8,
              }}
            />
          }
          loading={previewDataResult.loading}
          onClick={onPreviewData}
          data-ph-capture="true"
          data-ph-capture-attribute-name="view_sql_preview_data"
        >
          查看结果
        </Button>
        {previewDataResult?.data?.previewData && (
          <div className="mt-2 mb-3">
            <PreviewData
              error={previewDataResult.error}
              loading={previewDataResult.loading}
              previewData={previewDataResult?.data?.previewData}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未找到符合当前筛选条件的记录。"
                  />
                ),
              }}
            />
            <div className="text-right">
              <Text className="text-base gray-6">最多展示 500 行</Text>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
