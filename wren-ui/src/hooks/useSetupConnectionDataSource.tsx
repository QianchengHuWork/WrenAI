import { useRouter } from 'next/router';
import { useState, useCallback } from 'react';
import { gql, useQuery } from '@apollo/client';
import {
  Path,
  REDSHIFT_AUTH_METHOD,
  DATABRICKS_AUTH_METHOD,
} from '@/utils/enum';
import { useSaveDataSourceMutation } from '@/apollo/client/graphql/dataSource.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';

const PASSWORD_PLACEHOLDER = '************';

const DATA_SOURCE_SETUP_PROGRESS = gql`
  query DataSourceSetupProgress {
    dataSourceSetupProgress {
      status
      dataSourceType
      currentStepKey
      error
      updatedAt
      steps {
        key
        title
        status
        description
      }
    }
  }
`;

export type DataSourceSetupProgress = {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  dataSourceType?: string | null;
  currentStepKey?: string | null;
  error?: string | null;
  updatedAt: string;
  steps: Array<{
    key: string;
    title: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    description?: string | null;
  }>;
};

export default function useSetupConnectionDataSource() {
  const router = useRouter();
  const [selected, setSelected] = useState<DataSourceName>();
  const [trackingProgress, setTrackingProgress] = useState(false);

  const { data: progressData } = useQuery<{
    dataSourceSetupProgress: DataSourceSetupProgress;
  }>(DATA_SOURCE_SETUP_PROGRESS, {
    skip: !trackingProgress || selected !== DataSourceName.DENODO_MCP,
    pollInterval:
      trackingProgress && selected === DataSourceName.DENODO_MCP ? 1500 : 0,
    fetchPolicy: 'network-only',
  });

  const [saveDataSourceMutation, { loading, error }] =
    useSaveDataSourceMutation({
      onError: (error) => console.error(error),
      onCompleted: () => completedDataSourceSave(),
    });

  const selectDataSourceNext = useCallback(
    (payload: { dataSource: DataSourceName; dispatch?: () => void }) => {
      setSelected(payload.dataSource);
      payload?.dispatch?.();
    },
    [router],
  );

  const saveDataSource = useCallback(
    async (properties?: Record<string, any>) => {
      if (selected === DataSourceName.DENODO_MCP) {
        setTrackingProgress(true);
      }
      await saveDataSourceMutation({
        variables: {
          data: {
            type: selected,
            properties: transformFormToProperties(properties, selected),
          },
        },
      });
    },
    [selected, saveDataSourceMutation],
  );

  const completedDataSourceSave = useCallback(async () => {
    setTrackingProgress(false);
    if (selected === DataSourceName.DENODO_MCP) {
      router.push(Path.Modeling);
      return;
    }
    router.push(Path.OnboardingModels);
  }, [selected, router]);

  return {
    loading,
    error,
    selected,
    setupProgress: progressData?.dataSourceSetupProgress,
    saveDataSource,
    selectDataSourceNext,
    completedDataSourceSave,
    reset: () => {
      setTrackingProgress(false);
      setSelected(undefined);
    },
  };
}

export const transformFormToProperties = (
  properties: Record<string, any>,
  dataSourceType: DataSourceName,
) => {
  if (dataSourceType === DataSourceName.DUCKDB) {
    const configurations = properties.configurations.reduce((acc, cur) => {
      if (cur.key && cur.value) {
        acc[cur.key] = cur.value;
      }

      return acc;
    }, {});

    return {
      ...properties,
      configurations,
      extensions: properties.extensions.filter((i) => i),
    };
  } else if (dataSourceType === DataSourceName.SNOWFLAKE) {
    return {
      ...properties,
      ...getSnowflakeAuthentication(properties),
    };
  } else if (dataSourceType === DataSourceName.DATABRICKS) {
    return {
      ...properties,
      ...getDatabricksAuthentication(properties),
    };
  } else if (dataSourceType === DataSourceName.ATHENA) {
    return {
      ...properties,
      ...getAthenaAuthentication(properties),
    };
  }

  return {
    ...properties,
    // remove password placeholder if user doesn't change the password
    password:
      properties?.password === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.password,

    awsSecretKey:
      properties?.awsSecretKey === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.awsSecretKey,
  };
};

export const transformPropertiesToForm = (
  properties: Record<string, any>,
  dataSourceType: DataSourceName,
) => {
  if (dataSourceType === DataSourceName.BIG_QUERY) {
  } else if (dataSourceType === DataSourceName.DUCKDB) {
    const configurations = Object.entries(properties?.configurations || {}).map(
      ([key, value]) => ({ key, value }),
    );
    const extensions = properties?.extensions || [];
    return {
      ...properties,
      // If there are no configurations or extensions, add an empty one, or the form properties will break
      configurations: configurations.length
        ? configurations
        : [{ key: '', value: '' }],
      extensions: extensions.length ? extensions : [''],
    };
  } else if (dataSourceType === DataSourceName.REDSHIFT) {
    return {
      ...properties,
      ...(properties?.redshiftType === REDSHIFT_AUTH_METHOD.redshift
        ? {
            password: properties?.password || PASSWORD_PLACEHOLDER,
          }
        : {
            awsSecretKey: properties?.awsSecretKey || PASSWORD_PLACEHOLDER,
          }),
    };
  } else if (dataSourceType === DataSourceName.DATABRICKS) {
    return {
      ...properties,
      ...(properties?.databricksType ===
      DATABRICKS_AUTH_METHOD.service_principal
        ? {
            clientSecret: properties?.clientSecret || PASSWORD_PLACEHOLDER,
          }
        : {
            accessToken: properties?.accessToken || PASSWORD_PLACEHOLDER,
          }),
    };
  }

  return {
    ...properties,
    // provide a password placeholder to UI
    password: properties?.password || PASSWORD_PLACEHOLDER,
    privateKey: properties?.privateKey || undefined,
  };
};

function getSnowflakeAuthentication(properties: Record<string, any>) {
  // Set password or private key to null if only one of them is provided
  if (properties?.privateKey) {
    return {
      privateKey: properties?.privateKey,
      password: null,
    };
  }
  if (properties?.password && properties?.password !== PASSWORD_PLACEHOLDER) {
    return {
      password: properties?.password,
      privateKey: null,
    };
  }
  return {};
}

function getDatabricksAuthentication(properties: Record<string, any>) {
  if (properties?.databricksType === DATABRICKS_AUTH_METHOD.service_principal) {
    return {
      clientSecret:
        properties?.clientSecret === PASSWORD_PLACEHOLDER
          ? undefined
          : properties?.clientSecret,
    };
  }

  return {
    accessToken:
      properties?.accessToken === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.accessToken,
  };
}

function getAthenaAuthentication(properties: Record<string, any>) {
  if (properties?.webIdentityToken) {
    return {
      webIdentityToken:
        properties?.webIdentityToken === PASSWORD_PLACEHOLDER
          ? undefined
          : properties?.webIdentityToken,
    };
  }

  return {
    awsSecretKey:
      properties?.awsSecretKey === PASSWORD_PLACEHOLDER
        ? undefined
        : properties?.awsSecretKey,
  };
}
