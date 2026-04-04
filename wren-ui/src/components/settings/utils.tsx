import { SETTINGS } from '@/utils/enum';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import ProjectOutlined from '@ant-design/icons/ProjectOutlined';

export const getSettingMenu = (menu: SETTINGS) =>
  ({
    [SETTINGS.DATA_SOURCE]: {
      icon: DatabaseOutlined,
      label: '数据源设置',
    },
    [SETTINGS.PROJECT]: {
      icon: ProjectOutlined,
      label: '项目设置',
    },
  })[menu] || null;
