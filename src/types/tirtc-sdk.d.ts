declare module '*.es.min.js' {
  export type TiRtcEnvironment = 'production' | 'pre' | 'test'

  export interface TiRtcInitOptionsShape {
    appId: string
    environment?: TiRtcEnvironment
  }

  export interface TiRtcConnectOptions {
    deviceId: string
    token: string
  }

  export interface TiRtcStreamOptions {
    streamId: number
  }

  export interface TiRtcOutputOptions {
    connection: TiRtcConn
    streamId: number
  }

  export function TiRtcInitOptions(config: TiRtcInitOptionsShape): TiRtcInitOptionsShape

  export const TiRtc: {
    initialize(options: TiRtcInitOptionsShape): void
    videoOutputReady(): Promise<void>
  }

  export class TiRtcConn {
    connect(options: TiRtcConnectOptions): Promise<void>
    disconnect(): void
    subscribeAudio(options: TiRtcStreamOptions): void
    subscribeVideo(options: TiRtcStreamOptions): void
    unsubscribeAudio(options: TiRtcStreamOptions): void
    unsubscribeVideo(options: TiRtcStreamOptions): void
  }

  export function TiRtcAudioOutput(options: TiRtcOutputOptions): {
    attach(): void
    detach(): void
  }

  export function TiRtcVideoOutput(options: TiRtcOutputOptions): {
    attach(): void
    detach(): void
  }

  export function request(config: Record<string, unknown>): Promise<unknown>
}