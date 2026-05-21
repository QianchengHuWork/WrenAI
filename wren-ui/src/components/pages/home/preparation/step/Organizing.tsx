import { useEffect, useMemo, useRef } from 'react';
import { Typography } from 'antd';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import { Spinner } from '@/components/PageLoading';

interface Props {
  stream: string;
  selectedModels?: {
    primaryModel: string;
    secondaryModels: string[];
    needsJoin: boolean;
  } | null;
  normalizedQuery?: string | null;
  matchedRewrites?: Array<{
    scope: {
      model: string;
      column: string;
    };
    userPhrase: string;
    canonicalValue: string;
    reason?: string | null;
  }> | null;
  queryDecomposition?: {
    complexity: string;
    subqueryCount: number;
    subqueries: Array<{
      cteName: string;
      objective: string;
      grain?: string | null;
    }>;
  } | null;
  loading?: boolean;
  isAdjustment?: boolean;
}

type ReasoningStep = {
  index: number;
  title: string;
  body: string;
};

const stripMarkdownDecorations = (value: string) =>
  value
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*\*\*/, '')
    .replace(/\*\*\s*$/, '')
    .replace(/^\s+|\s+$/g, '')
    .trim();

const parseNumberedSteps = (content: string): ReasoningStep[] => {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const regex =
    /(?:^|\n)(?:\*\*)?(\d+)\.\s*([^\n*]+?)(?:\*\*)?(?:\s*\n+)([\s\S]*?)(?=(?:\n(?:\*\*)?\d+\.\s)|$)/g;
  const steps: ReasoningStep[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    steps.push({
      index: Number(match[1]),
      title: stripMarkdownDecorations(match[2]),
      body: match[3].trim(),
    });
  }

  if (steps.length) return steps;

  const blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) return [];

  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const [firstLine, ...restLines] = lines;

    return {
      index: index + 1,
      title: stripMarkdownDecorations(firstLine || `步骤 ${index + 1}`),
      body: restLines.join('\n').trim(),
    };
  });
};

export default function Organizing(props: Props) {
  const $wrapper = useRef<HTMLDivElement>(null);
  const {
    stream,
    loading,
    isAdjustment,
    selectedModels,
    normalizedQuery,
    matchedRewrites,
    queryDecomposition,
  } = props;

  const isDone = stream && !loading;
  const steps = useMemo(() => parseNumberedSteps(stream), [stream]);
  const hasContextBlocks = !!(
    selectedModels ||
    normalizedQuery ||
    matchedRewrites?.length ||
    queryDecomposition?.subqueries?.length
  );

  const scrollBottom = () => {
    if ($wrapper.current) {
      $wrapper.current.scrollTo({
        top: $wrapper.current.scrollHeight,
      });
    }
  };

  useEffect(() => {
    scrollBottom();
  }, [stream]);

  useEffect(() => {
    if (isDone) scrollBottom();
  }, [isDone]);

  const title = isAdjustment ? '已应用用户提供的推理步骤' : '正在组织思路';
  const renderContextBlocks = () => (
    <>
      {!!selectedModels && (
        <div>
          <div className="gray-8 font-medium">已选作用域</div>
          <div className="mt-1 pl-4">
            主模型: {selectedModels.primaryModel}
            {!!selectedModels.secondaryModels?.length &&
              `；辅助模型: ${selectedModels.secondaryModels.join(', ')}`}
            {selectedModels.needsJoin ? '；需要 Join' : ''}
          </div>
        </div>
      )}
      {!!normalizedQuery && (
        <div>
          <div className="gray-8 font-medium">归一化问题</div>
          <div className="mt-1 pl-4">{normalizedQuery}</div>
        </div>
      )}
      {!!queryDecomposition?.subqueries?.length && (
        <div>
          <div className="gray-8 font-medium">问题拆解</div>
          <div className="mt-1 pl-4">
            <div>
              正在拆解问题为 {queryDecomposition.subqueryCount} 个子任务
            </div>
            {queryDecomposition.subqueries.map((subquery) => (
              <div key={subquery.cteName}>
                {subquery.objective}
                {!!subquery.grain && `（粒度：${subquery.grain}）`}
              </div>
            ))}
          </div>
        </div>
      )}
      {!!matchedRewrites?.length && (
        <div>
          <div className="gray-8 font-medium">命中改写</div>
          <div className="mt-1 pl-4">
            {matchedRewrites.map((rewrite) => (
              <div
                key={`${rewrite.scope.model}.${rewrite.scope.column}.${rewrite.userPhrase}.${rewrite.canonicalValue}`}
              >
                {rewrite.scope.model}.{rewrite.scope.column}: "
                {rewrite.userPhrase}" → "{rewrite.canonicalValue}"
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      <Typography.Text className="gray-8">{title}</Typography.Text>
      <div
        ref={$wrapper}
        className="gray-7 text-sm mt-2"
        style={{ maxHeight: 'calc(100vh - 550px)', overflowY: 'auto' }}
      >
        {loading && !stream ? (
          <div className="d-flex flex-column gy-3">
            {hasContextBlocks && renderContextBlocks()}
            <div className="d-flex align-center gx-2">
              思考中
              <Spinner className="gray-6" size={12} />
            </div>
          </div>
        ) : steps.length ? (
          <div className="d-flex flex-column gy-3">
            {renderContextBlocks()}
            {steps.map((step) => (
              <div key={`${step.index}-${step.title}`}>
                <div className="gray-8 font-medium">
                  {step.index}. {step.title}
                </div>
                {!!step.body && (
                  <div className="mt-1 pl-4">
                    <MarkdownBlock content={step.body} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="d-flex flex-column gy-3">
            {renderContextBlocks()}
            <MarkdownBlock content={stream} />
          </div>
        )}
      </div>
    </>
  );
}
