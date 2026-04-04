import styled from 'styled-components';

const BrandText = styled.div`
  display: inline-flex;
  align-items: center;
  color: inherit;
  font-family:
    'IBM Plex Sans',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
`;

export default function LogoBar() {
  return <BrandText>Zen-SmartBI</BrandText>;
}
