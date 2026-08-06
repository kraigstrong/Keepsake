import { Stack, useLocalSearchParams } from 'expo-router';

import { OriginalPhotoScreen } from '../../../src/recipes/OriginalPhotoScreen';

export default function OriginalPhotoRoute() {
  const { path } = useLocalSearchParams<{ id: string; path: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Original Photo' }} />
      <OriginalPhotoScreen photoPath={path} />
    </>
  );
}
