import axios from 'axios';
import { GeneralErrorCodes } from '@server/utils/error';
import { DenodoMcpAdaptor } from '../denodoMcpAdaptor';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DenodoMcpAdaptor', () => {
  const connectionInfo = {
    baseUrl: 'http://denodo.example.com/admin/mcp',
    databaseName: 'admin',
    username: 'admin',
    password: 'secret',
  };

  let adaptor: DenodoMcpAdaptor;

  beforeEach(() => {
    adaptor = new DenodoMcpAdaptor();
    jest.clearAllMocks();
    mockedAxios.delete.mockResolvedValue({
      data: '',
      headers: {},
      status: 200,
      statusText: 'OK',
      config: {} as any,
    });
  });

  it('throws when MCP tool execution returns an isError payload', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: 'init',
          result: { protocolVersion: '2025-03-26' },
        }),
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        },
        status: 200,
        statusText: 'OK',
        config: {} as any,
      })
      .mockResolvedValueOnce({
        data: '',
        headers: { 'content-type': 'application/json' },
        status: 200,
        statusText: 'OK',
        config: {} as any,
      })
      .mockResolvedValueOnce({
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tool',
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: "Function 'date_part' not found.",
              },
            ],
          },
        }),
        headers: { 'content-type': 'application/json' },
        status: 200,
        statusText: 'OK',
        config: {} as any,
      });

    await expect(
      adaptor.runSqlQuery('SELECT 1', connectionInfo),
    ).rejects.toMatchObject({
      message: "Function 'date_part' not found.",
      extensions: {
        code: GeneralErrorCodes.SQL_EXECUTION_ERROR,
      },
    });

    expect(mockedAxios.delete).toHaveBeenCalledWith(connectionInfo.baseUrl, {
      headers: expect.objectContaining({
        Authorization: expect.stringMatching(/^Basic /),
        'Mcp-Session-Id': 'session-1',
      }),
      timeout: 30000,
      validateStatus: expect.any(Function),
    });
  });

  it('fetches Denodo associations from the derived Data Catalog endpoint', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          name: 'assoc_profile_assign',
          leftViewName: 'j_cfc_clew_profile_semantic_std',
          rightViewName: 'j_clew_assign_event_semantic_std',
          leftMultiplicity: '1',
          rightMultiplicity: '0,*',
          mapping:
            'j_cfc_clew_profile_semantic_std.clew_id=j_clew_assign_event_semantic_std.clew_id',
          valid: true,
        },
      ],
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
      config: {} as any,
    });

    const result = await adaptor.getViewAssociations(
      connectionInfo,
      'j_cfc_clew_profile_semantic_std',
    );

    expect(result).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://denodo.example.com:9090/denodo-data-catalog/public/api/views/associations',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
        params: {
          databaseName: 'admin',
          viewName: 'j_cfc_clew_profile_semantic_std',
          uri: '//denodo.example.com:9999/admin',
          serverId: 1,
        },
        timeout: 30000,
        validateStatus: expect.any(Function),
      }),
    );
  });
});
