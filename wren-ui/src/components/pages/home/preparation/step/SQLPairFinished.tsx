import { Typography } from 'antd';

export default function SQLPairFinished() {
  return (
    <>
      <Typography.Text className="gray-8">正在使用问题-SQL 对</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>已找到匹配的问题-SQL 对，正在直接返回结果。</div>
      </div>
    </>
  );
}
