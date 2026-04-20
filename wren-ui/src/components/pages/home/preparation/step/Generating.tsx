import { Typography } from 'antd';
import { Spinner } from '@/components/PageLoading';

interface Props {
  generating?: boolean;
  correcting?: boolean;
  loading?: boolean;
  toolCalls?: string[];
  semanticFiles?: string[];
}

type GeneratingSection = {
  title: string;
  items: string[];
};

const buildSections = ({
  semanticFiles,
  toolCalls,
}: {
  semanticFiles?: string[];
  toolCalls?: string[];
}): GeneratingSection[] => {
  const sections: GeneratingSection[] = [];

  if (semanticFiles?.length) {
    sections.push({
      title: '已查看语义文件',
      items: semanticFiles,
    });
  }

  if (toolCalls?.length) {
    sections.push({
      title: '执行调用',
      items: toolCalls,
    });
  }

  return sections;
};

export default function Generating(props: Props) {
  const { loading, generating, correcting, toolCalls, semanticFiles } = props;
  const sections = buildSections({ semanticFiles, toolCalls });

  return (
    <>
      <Typography.Text className="gray-8">正在生成 SQL 语句</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {generating || correcting ? (
          <>
            <div className="d-flex align-center gx-2">
              {correcting ? '正在修正 SQL 语句' : '正在生成'}
              <Spinner className="gray-6" size={12} />
            </div>
            {!!sections.length && (
              <div className="d-flex flex-column gy-3 mt-2">
                {sections.map((section, index) => (
                  <div key={section.title}>
                    <div className="gray-8 font-medium">
                      {index + 1}. {section.title}
                    </div>
                    <div className="mt-1 pl-4">
                      {section.items.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div>SQL 语句生成成功</div>
            {!!sections.length && (
              <div className="d-flex flex-column gy-3 mt-2">
                {sections.map((section, index) => (
                  <div key={section.title}>
                    <div className="gray-8 font-medium">
                      {index + 1}. {section.title}
                    </div>
                    <div className="mt-1 pl-4">
                      {section.items.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
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
