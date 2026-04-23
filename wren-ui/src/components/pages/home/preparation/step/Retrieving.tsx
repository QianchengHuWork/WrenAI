import { Typography, Tag } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { Spinner } from '@/components/PageLoading';

interface Props {
  tables: string[];
  selectedTables?: string[];
  loading?: boolean;
  isAdjustment?: boolean;
}

const TagTemplate = ({ name }: { name: string }) => {
  return <Tag className="gray-7 mb-2">{name}</Tag>;
};

const TagIterator = makeIterable(TagTemplate);

export default function Retrieving(props: Props) {
  const { tables, selectedTables = [], loading, isAdjustment } = props;

  const data = tables.map((table) => ({ name: table }));
  const selectedData = selectedTables.map((table) => ({ name: table }));

  const title = isAdjustment
    ? '已应用用户选择的模型'
    : '正在检索前 10 个候选模型';

  const modelDescription = isAdjustment ? (
    <>已应用 {tables.length} 个模型</>
  ) : (
    <>已识别出前 {tables.length} 个候选模型</>
  );

  return (
    <>
      <Typography.Text className="gray-8">{title}</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {loading ? (
          <div className="d-flex align-center gx-2">
            检索中
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <>
            <div className="mb-1">{modelDescription}</div>
            <TagIterator data={data} />
            {!!selectedData.length && (
              <div className="mt-2">
                <div className="mb-1 gray-8">最终选中模型</div>
                <TagIterator data={selectedData} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
