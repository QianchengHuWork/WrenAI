import { Typography } from 'antd';

export default function ViewFinished() {
  return (
    <>
      <Typography.Text className="gray-8">正在使用已保存视图</Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>已找到匹配的已保存视图，正在直接返回结果。</div>
      </div>
    </>
  );
}
