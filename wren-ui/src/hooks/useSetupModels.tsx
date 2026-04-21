import { useState } from 'react';
import { Path, SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import {
  useListDataSourceTablesQuery,
  useSaveTablesMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import useOnboardingStatus from '@/hooks/useCheckOnboarding';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);

  const router = useRouter();
  const { refetch: refetchOnboardingStatus } = useOnboardingStatus();

  const { data, loading: fetching } = useListDataSourceTablesQuery({
    fetchPolicy: 'no-cache',
    onError: (error) => console.error(error),
  });
  const { data: settingsData } = useGetSettingsQuery({
    fetchPolicy: 'cache-first',
  });

  // Handle errors via try/catch blocks rather than onError callback
  const [saveTablesMutation, { loading: submitting }] = useSaveTablesMutation();

  const submitModels = async (tables: string[]) => {
    try {
      await saveTablesMutation({
        variables: {
          data: { tables },
        },
      });
      await refetchOnboardingStatus();
      router.push(
        settingsData?.settings?.dataSource?.type === DataSourceName.DENODO_MCP
          ? Path.Modeling
          : Path.OnboardingRelationships,
      );
    } catch (error) {
      console.error(error);
    }
  };

  const onBack = () => {
    router.push(Path.OnboardingConnection);
  };

  const onNext = (data: { selectedTables: string[] }) => {
    submitModels(data.selectedTables);
  };

  return {
    submitting,
    fetching,
    stepKey,
    onBack,
    onNext,
    tables: data?.listDataSourceTables || [],
    dataSourceType: settingsData?.settings?.dataSource?.type,
  };
}
