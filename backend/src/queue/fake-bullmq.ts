import { EventEmitter } from 'events';

const globalEmitter = new EventEmitter();

export class Queue<T = any> {
    constructor(public name: string, opts?: any) {}
    
    async add(jobName: string, data: T, opts?: any) {
        // Run in next tick so the caller can return the job ID immediately
        setTimeout(() => {
            globalEmitter.emit(`job:${this.name}`, { id: (data as any).jobId || Date.now().toString(), name: jobName, data });
        }, 10);
        return { id: (data as any).jobId || Date.now().toString() };
    }

    async getJob(jobId: string) {
        return null;
    }
}

export class Worker<T = any> {
    private emitter = new EventEmitter();
    
    constructor(public name: string, processor: (job: any) => Promise<any>, opts?: any) {
        globalEmitter.on(`job:${name}`, async (job) => {
            try {
                const result = await processor(job);
                this.emitter.emit('completed', { ...job, returnvalue: result });
            } catch (err) {
                this.emitter.emit('failed', job, err);
            }
        });
    }

    on(event: string, listener: (...args: any[]) => void) {
        this.emitter.on(event, listener);
    }
}
