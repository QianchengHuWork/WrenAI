import { Button, Typography } from 'antd';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { COLUMN } from '@/components/table/BaseTable';
import FieldTable from '@/components/table/FieldTable';
import { DiagramView } from '@/utils/data';
import { usePreviewViewDataMutation } from '@/apollo/client/graphql/view.generated';

export type Props = DiagramView;

export default function ViewMetadata(props: Props) {
  const {
    displayName,
    description,
    fields = [],
    statement,
    viewId,
  } = props || {};

  const [previewViewData, previewViewDataResult] = usePreviewViewDataMutation({
    onError: (error) => console.error(error),
  });

  const onPreviewData = () => {
    previewViewData({ variables: { where: { id: viewId } } });
  };

  // View only can input Name (alias), so it should show alias as Name in metadata.
  return (
    <>
      <div className="mb-6" data-testid="metadata__name">
        <Typography.Text className="d-block gray-7 mb-2">名称</Typography.Text>
        <div>{displayName || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__description">
        <Typography.Text className="d-block gray-7 mb-2">描述</Typography.Text>
        <div>{description || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__columns">
        <Typography.Text className="d-block gray-7 mb-2">
          字段（{fields.length}）
        </Typography.Text>
        <FieldTable
          columns={[COLUMN.NAME, COLUMN.TYPE, COLUMN.DESCRIPTION]}
          dataSource={fields}
          showExpandable
        />
      </div>

      <div className="mb-6" data-testid="metadata__sql-statement">
        <Typography.Text className="d-block gray-7 mb-2">
          SQL 语句
        </Typography.Text>
        <SQLCodeBlock code={statement} showLineNumbers maxHeight="300" />
      </div>

      <div className="mb-6" data-testid="metadata__preview-data">
        <Typography.Text className="d-block gray-7 mb-2">
          数据预览（100 行）
        </Typography.Text>
        <Button onClick={onPreviewData} loading={previewViewDataResult.loading}>
          预览数据
        </Button>
        <div className="my-3">
          <PreviewData
            error={previewViewDataResult.error}
            loading={previewViewDataResult.loading}
            previewData={previewViewDataResult?.data?.previewViewData}
          />
        </div>
      </div>
    </>
  );
}
