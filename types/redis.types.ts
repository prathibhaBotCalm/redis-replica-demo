import Redis from "ioredis";
import { Client } from "redis-om";

export interface RedisManagerEvents {
  'client-ready': (client: Redis) => void;
  'client-error': (error: Error) => void;
  'client-disconnected': () => void;
  'client-reconnecting': () => void;
  'om-client-initialized': (client: Client) => void;
  'failover-complete': (masterAddress: MasterAddress) => void;
  'failover-error': (error: Error) => void;
  'initialization-complete': () => void;
  'initialization-failed': (error: Error) => void;
  'shutdown-complete': () => void;
  'shutdown-error': (error: Error) => void;
  'connection-error': (error: Error) => void;
  'connections-closed': () => void;
}

// Config and address types
export interface SentinelConfig {
  host: string;
  port: number;
}
export interface MasterAddress {
  host: string;
  port: number;
}
export interface RedisConfig {
  masterName: string;
  password?: string;
  sentinelPassword?: string;
  port: number;
  pollIntervalMs: number;
  hosts: { development: string; production: string };
  sentinels: { development: string; production: string };
  maxRetries: number;
  connectionTimeout: number;
}
