import { Form, Row, Col, Select } from 'antd';
import {
  PropertiesProps,
  getColumnOptions,
  getChartTypeOptions,
  ChartTypeProperty,
} from './BasicProperties';

export default function DonutProperties(props: PropertiesProps) {
  const { columns, titleMap } = props;
  const chartTypeOptions = getChartTypeOptions();
  const columnOptions = getColumnOptions(columns, titleMap);
  return (
    <>
      <Row gutter={16} className="mb-2">
        <Col span={12}>
          <ChartTypeProperty options={chartTypeOptions} />
        </Col>
        <Col span={12}>
          <Form.Item className="mb-0" label="分类" name="color">
            <Select
              size="small"
              options={columnOptions}
              placeholder="请选择分类"
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item className="mb-0" label="数值" name="theta">
            <Select
              size="small"
              options={columnOptions}
              placeholder="请选择数值"
            />
          </Form.Item>
        </Col>
        <Col span={12}></Col>
      </Row>
    </>
  );
}
