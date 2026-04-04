import { useRouter } from 'next/router';
import { Layout, Tooltip } from 'antd';
import styled from 'styled-components';
import MenuOutlined from '@ant-design/icons/MenuOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';
import Settings from '@/components/settings';
import useModalAction from '@/hooks/useModalAction';
import useGlobalConfig from '@/hooks/useGlobalConfig';

const { Header } = Layout;

const StyledHeader = styled(Header)`
  height: 48px;
  border-bottom: 1px solid #393939;
  background: #161616;
  padding: 0;
  line-height: normal;
`;

const HeaderInner = styled.div`
  display: flex;
  align-items: center;
  height: 100%;
  min-width: 0;
`;

const HeaderStart = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
`;

const MenuButton = styled.button`
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-right: 1px solid #393939;
  background: transparent;
  color: #f4f4f4;
  cursor: pointer;

  &:hover,
  &:focus {
    background: #262626;
    color: #ffffff;
  }
`;

const BrandButton = styled.button`
  height: 48px;
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: #f4f4f4;
  padding: 0 32px 0 16px;
  cursor: pointer;

  &:hover,
  &:focus {
    background: #262626;
    color: #ffffff;
  }
`;

const Nav = styled.nav`
  min-width: 0;
`;

const NavList = styled.ul`
  display: flex;
  align-items: stretch;
  list-style: none;
  margin: 0;
  padding: 0;
  height: 48px;
`;

const NavButton = styled.button<{ $isActive: boolean }>`
  position: relative;
  height: 48px;
  display: inline-flex;
  align-items: center;
  padding: 0 16px;
  border: none;
  background: ${(props) => (props.$isActive ? '#262626' : 'transparent')};
  color: ${(props) => (props.$isActive ? '#f4f4f4' : '#c6c6c6')};
  font-family:
    'IBM Plex Sans',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;

  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: ${(props) => (props.$isActive ? '3px' : '0')};
    background: #0f62fe;
  }

  &:hover,
  &:focus {
    background: #262626;
    color: #f4f4f4;
  }
`;

const HeaderEnd = styled.div`
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
`;

const DeployWrap = styled.div`
  display: flex;
  align-items: center;
  padding-right: 12px;
`;

const HeaderActionButton = styled.button`
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-left: 1px solid #393939;
  background: transparent;
  color: #f4f4f4;
  cursor: pointer;

  &:hover,
  &:focus {
    background: #262626;
    color: #ffffff;
  }
`;

const HeaderActionStatic = styled.div`
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid #393939;
  color: #f4f4f4;
`;

const NavLabel = styled.span`
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export default function HeaderBar() {
  const router = useRouter();
  const { pathname } = router;
  const settings = useModalAction();
  const { config } = useGlobalConfig();
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isModeling = pathname.startsWith(Path.Modeling);
  const userLabel = config?.userUUID || 'dev-static';
  const navItems = [
    {
      label: '首页',
      active: pathname.startsWith(Path.Home),
      path: Path.Home,
    },
    {
      label: '建模',
      active: pathname.startsWith(Path.Modeling),
      path: Path.Modeling,
    },
    {
      label: '知识库',
      active: pathname.startsWith(Path.Knowledge),
      path: Path.KnowledgeQuestionSQLPairs,
    },
    {
      label: '接口',
      active: pathname.startsWith(Path.APIManagement),
      path: Path.APIManagementHistory,
    },
  ];

  return (
    <>
      <StyledHeader>
        <HeaderInner>
          <HeaderStart>
            <Tooltip title="主菜单">
              <MenuButton
                aria-label="打开菜单"
                type="button"
                onClick={() => router.push(Path.Home)}
              >
                <MenuOutlined />
              </MenuButton>
            </Tooltip>
            <BrandButton type="button" onClick={() => router.push(Path.Home)}>
              <LogoBar />
            </BrandButton>
            {showNav && (
              <Nav aria-label="主导航">
                <NavList>
                  {navItems.map((item) => (
                    <li key={item.label}>
                      <NavButton
                        type="button"
                        $isActive={item.active}
                        onClick={() => router.push(item.path)}
                      >
                        <NavLabel>{item.label}</NavLabel>
                      </NavButton>
                    </li>
                  ))}
                </NavList>
              </Nav>
            )}
          </HeaderStart>
          <HeaderEnd>
            {isModeling && (
              <DeployWrap>
                <Deploy />
              </DeployWrap>
            )}
            <Tooltip title="设置">
              <HeaderActionButton
                aria-label="设置"
                type="button"
                onClick={() => settings.openModal()}
              >
                <SettingOutlined />
              </HeaderActionButton>
            </Tooltip>
            <Tooltip title={`用户：${userLabel}`}>
              <HeaderActionStatic aria-label={`用户：${userLabel}`}>
                <UserOutlined />
              </HeaderActionStatic>
            </Tooltip>
          </HeaderEnd>
        </HeaderInner>
      </StyledHeader>
      <Settings {...settings.state} onClose={settings.closeModal} />
    </>
  );
}
