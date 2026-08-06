import { Stack } from 'expo-router';

import { PhotoImportScreen } from '../../src/import/PhotoImportScreen';

export default function ImportPhotoRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Import from Photo' }} />
      <PhotoImportScreen />
    </>
  );
}
