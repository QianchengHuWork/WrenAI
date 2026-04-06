import { Button, Modal, Select, Row, Col, Form, message } from 'antd';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import {
  useResetCurrentProjectMutation,
  useUpdateCurrentProjectMutation,
} from '@/apollo/client/graphql/settings.generated';
import { getLanguageText } from '@/utils/language';
import { ProjectLanguage } from '@/apollo/client/graphql/__types__';

interface Props {
  data: { language: string };
}

export default function ProjectSettings(props: Props) {
  const { data } = props;
  const router = useRouter();
  const [form] = Form.useForm();
  const [resetCurrentProject, { client }] = useResetCurrentProjectMutation({
    onError: (error) => console.error(error),
  });
  const languageOptions = Object.keys(ProjectLanguage).map((key) => {
    return { label: getLanguageText(key as ProjectLanguage), value: key };
  });

  const [updateCurrentProject, { loading }] = useUpdateCurrentProjectMutation({
    refetchQueries: ['GetSettings'],
    onError: (error) => console.error(error),
    onCompleted: () => {
      message.success('项目语言更新成功。');
    },
  });

  const reset = () => {
    Modal.confirm({
      title: '确定要重置项目吗？',
      okButtonProps: { danger: true },
      okText: '重置',
      onOk: async () => {
        await resetCurrentProject();
        client.clearStore();
        router.push(Path.OnboardingConnection);
      },
    });
  };

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        updateCurrentProject({ variables: { data: values } });
      })
      .catch((error) => console.error(error));
  };

  return (
    <div className="py-3 px-4">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ language: data.language }}
      >
        <Form.Item label="项目语言" extra="该设置会影响 AI 回复你的语言。">
          <Row gutter={16} wrap={false}>
            <Col className="flex-grow-1">
              <Form.Item name="language" noStyle>
                <Select
                  placeholder="请选择语言"
                  showSearch
                  options={languageOptions}
                />
              </Form.Item>
            </Col>
            <Col>
              <Button
                type="primary"
                style={{ width: 70 }}
                onClick={submit}
                loading={loading}
              >
                保存
              </Button>
            </Col>
          </Row>
        </Form.Item>
      </Form>
      <div className="gray-8 mb-2">重置项目</div>
      <Button type="primary" style={{ width: 70 }} danger onClick={reset}>
        重置
      </Button>
      <div className="gray-6 mt-1">
        请注意，重置会删除当前全部设置和记录，包括建模页配置与首页对话。
      </div>
    </div>
  );
}
