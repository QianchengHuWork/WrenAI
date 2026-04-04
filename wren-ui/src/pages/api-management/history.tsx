import Link from 'next/link';
import { useState } from 'react';
import { Table, TableColumnsType, Button, Tag, Typography } from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import useDrawerAction from '@/hooks/useDrawerAction';
import { getColumnSearchProps } from '@/utils/table';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import DetailsDrawer from '@/components/pages/apiManagement/DetailsDrawer';
import { useApiHistoryQuery } from '@/apollo/client/graphql/apiManagement.generated';
import { ApiType, ApiHistoryResponse } from '@/apollo/client/graphql/__types__';

const PAGE_SIZE = 10;

export default function APIHistory() {
  const detailsDrawer = useDrawerAction();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [filters, setFilters] = useState<Record<string, any>>({});

  const { data, loading } = useApiHistoryQuery({
    fetchPolicy: 'cache-and-network',
    variables: {
      pagination: {
        offset: (currentPage - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      },
      filter: {
        apiType: filters['apiType']?.[0],
        statusCode: filters['statusCode']?.[0],
        threadId: filters['threadId']?.[0],
      },
    },
    onError: (error) => console.error(error),
  });

  const columns: TableColumnsType<ApiHistoryResponse> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (timestamp: string) => (
        <div className="gray-7">{getAbsoluteTime(timestamp)}</div>
      ),
    },
    {
      title: '接口类型',
      dataIndex: 'apiType',
      key: 'apiType',
      width: 180,
      render: (type: ApiHistoryResponse['apiType']) => (
        <Tag className="gray-8">{type.toLowerCase()}</Tag>
      ),
      filters: Object.keys(ApiType).map((type) => ({
        text: type.toLowerCase(),
        value: type,
      })),
      filteredValue: filters['apiType'],
      filterMultiple: false,
    },
    {
      title: '状态',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 100,
      render: (status: number) => {
        const icon =
          status >= 200 && status < 300 ? (
            <CheckCircleOutlined />
          ) : (
            <CloseCircleOutlined />
          );
        const color = status >= 200 && status < 300 ? 'success' : 'error';
        return (
          <Tag icon={icon} color={color}>
            {status}
          </Tag>
        );
      },
      filters: [
        { text: '成功（状态码：2xx）', value: 200 },
        { text: '客户端错误（状态码：4xx）', value: 400 },
        { text: '服务端错误（状态码：5xx）', value: 500 },
      ],
      filteredValue: filters['statusCode'],
      filterMultiple: false,
    },
    {
      title: '问题 / SQL',
      dataIndex: 'requestPayload',
      key: 'requestPayload',
      render: (payload: Record<string, any>, record: ApiHistoryResponse) => {
        if (record.apiType === ApiType.RUN_SQL && payload.sql) {
          return (
            <div style={{ width: '100%' }}>
              <SQLCodeBlock code={payload.sql} maxHeight="130" />
            </div>
          );
        }
        return (
          <div className="gray-8">
            {payload?.question || payload?.sql || '-'}
          </div>
        );
      },
    },
    {
      title: '对话 ID',
      dataIndex: 'threadId',
      key: 'threadId',
      width: 200,
      render: (threadId: string) => {
        if (!threadId) return <div className="gray-7">-</div>;
        return (
          <Typography.Text
            ellipsis
            className="gray-7"
            copyable={{ text: threadId }}
          >
            {threadId}
          </Typography.Text>
        );
      },
      ...getColumnSearchProps({
        dataIndex: 'threadId',
        placeholder: '对话 ID',
        filteredValue: filters['threadId'],
      }),
    },
    {
      title: '耗时（毫秒）',
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 124,
      render: (durationMs: number) => (
        <div className="gray-7 text-right">{durationMs || '-'}</div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      align: 'center',
      fixed: 'right',
      render: (record) => (
        <Button
          className="gray-8"
          type="text"
          size="small"
          onClick={() => detailsDrawer.openDrawer(record)}
        >
          <EyeOutlined /> 详情
        </Button>
      ),
    },
  ];

  return (
    <SiderLayout loading={false} sidebar={null}>
      <PageLayout
        title={
          <>
            <ApiOutlined className="mr-2 gray-8" />
            接口历史
          </>
        }
        description={
          <>
            <div>
              你可以在这里查看完整的接口调用历史，包括请求参数、响应内容和执行详情。{' '}
              <Link
                className="gray-8 underline mr-2"
                href="https://docs.getwren.ai/oss/guide/api-access/history"
                target="_blank"
                rel="noopener noreferrer"
              >
                了解更多
              </Link>
            </div>
          </>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={data?.apiHistory.items || []}
          loading={loading}
          columns={columns}
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: PAGE_SIZE,
            size: 'small',
            total: data?.apiHistory.total,
          }}
          scroll={{ x: 1200 }}
          onChange={(pagination, filters, _sorter) => {
            setCurrentPage(pagination.current);
            setFilters(filters);
          }}
        />
        <DetailsDrawer
          {...detailsDrawer.state}
          onClose={detailsDrawer.closeDrawer}
        />
      </PageLayout>
    </SiderLayout>
  );
}
