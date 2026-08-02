import { NativeModule, requireNativeModule } from 'expo';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- NativeModule's EventsMap constraint needs `{}`, not `object`.
declare class AppGroupBridgeModule extends NativeModule<{}> {
  containerAvailable(): boolean;
  writeTestPayload(value: string): boolean;
  readTestPayload(): string | null;
  readSharePayload(): string | null;
  clearSharePayload(): boolean;
}

export default requireNativeModule<AppGroupBridgeModule>('AppGroupBridge');
