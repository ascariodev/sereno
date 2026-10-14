import * as Device from 'expo-device'

export function deviceName(): string {
  return (Device.deviceName ?? Device.modelName ?? 'Sereno app').slice(0, 255)
}
