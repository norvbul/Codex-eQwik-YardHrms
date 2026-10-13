import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import { jobs } from './core.js';
export class RedisRateStore implements Store {
  localKeys = false;
  windowMs = 60000;
  private prepared = false;
  constructor(readonly prefix: string) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private async client() {
    const client = await jobs.client;
    if (!this.prepared) {
      client.defineCommand('yardRateIncrement', {
        numberOfKeys: 1,
        lua: "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}",
      });
      client.defineCommand('yardRateDecrement', {
        numberOfKeys: 1,
        lua: "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if n>0 then redis.call('DECR',KEYS[1]); end; return 0",
      });
      this.prepared = true;
    }
    return client;
  }
  async increment(key: string): Promise<IncrementResponse> {
    const values = (await (
      await this.client()
    ).runCommand('yardRateIncrement', [this.prefix + key, String(this.windowMs)])) as [
      number,
      number,
    ];
    return { totalHits: values[0], resetTime: new Date(Date.now() + Math.max(0, values[1])) };
  }
  async decrement(key: string) {
    await (await this.client()).runCommand('yardRateDecrement', [this.prefix + key]);
  }
  async resetKey(key: string) {
    await (await jobs.client).del(this.prefix + key);
  }
}
