import { Typography } from 'antd';
import { Spinner } from '@/components/PageLoading';

interface Props {
  generating?: boolean;
  correcting?: boolean;
  loading?: boolean;
  toolCalls?: string[];
  semanticFiles?: string[];
}

export default function Generating(props: Props) {
  const { loading, generating, correcting, toolCalls, semanticFiles } = props;

  return (
    <>
      <Typography.Text className="gray-8">正在生成 SQL 语句</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {generating || correcting ? (
          <div className="d-flex align-center gx-2">
            {correcting ? '正在修正 SQL 语句' : '正在生成'}
            <Spinner className="gray-6" size={12} />
          </div>
        ) : (
          <>
            <div>SQL 语句生成成功</div>
            {!!semanticFiles?.length && (
              <div className="mt-1">
                <div>已查看语义文件：</div>
                {semanticFiles.map((file) => (
                  <div key={file}>{file}</div>
                ))}
              </div>
            )}
            {!!toolCalls?.length && (
              <div className="mt-1">
                <div>执行调用：</div>
                {toolCalls.map((toolCall) => (
                  <div key={toolCall}>{toolCall}</div>
                ))}
              </div>
            )}
            {loading && (
              <div className="d-flex align-center gx-2 mt-1">
                正在收尾 <Spinner className="gray-6" size={16} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
