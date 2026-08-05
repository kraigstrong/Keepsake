import { Stack, useLocalSearchParams } from 'expo-router';

import { ImportActivityScreen } from '../../../src/import/ImportActivityScreen';

export default function ImportActivityRoute() {
  const { batchId } = useLocalSearchParams<{ batchId: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Import Progress' }} />
      <ImportActivityScreen batchId={batchId} />
    </>
  );
}
