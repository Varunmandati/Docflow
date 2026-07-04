// In-memory mock of Redis to replace ioredis completely for local development
const store = new Map<string, string>();
const timers = new Map<string, NodeJS.Timeout>();

class MockRedis {
    async get(key: string) { return store.get(key) || null; }
    async set(key: string, value: string, mode?: string, ttl?: number) { 
        store.set(key, value); 
        if (mode === 'EX' && ttl) {
            if (timers.has(key)) clearTimeout(timers.get(key));
            timers.set(key, setTimeout(() => store.delete(key), ttl * 1000));
        }
        return 'OK'; 
    }
    async setex(key: string, ttl: number, value: string) {
        store.set(key, value);
        if (timers.has(key)) clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => store.delete(key), ttl * 1000));
        return 'OK';
    }
    async del(key: string) {
        store.delete(key);
        if (timers.has(key)) {
            clearTimeout(timers.get(key));
            timers.delete(key);
        }
        return 1;
    }
    async incr(key: string) {
        const val = parseInt(store.get(key) || '0') + 1;
        store.set(key, val.toString());
        return val;
    }
    async expire(key: string, ttl: number) {
        if (!store.has(key)) return 0;
        if (timers.has(key)) clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => store.delete(key), ttl * 1000));
        return 1;
    }
    async exists(key: string) { return store.has(key) ? 1 : 0; }
    on(event: string, handler: any) {}
}

export const redisConnection = new MockRedis() as any;
