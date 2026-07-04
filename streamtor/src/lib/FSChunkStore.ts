export class FSChunkStore {
  chunkLength: number;
  length: number;
  files: any[];
  dirHandle: FileSystemDirectoryHandle;
  fileHandles: Map<string, FileSystemFileHandle>;

  constructor(chunkLength: number, storeOpts: any, dirHandle: FileSystemDirectoryHandle) {
    this.chunkLength = chunkLength;
    this.length = storeOpts.length;
    this.files = storeOpts.files.map((f: any) => ({
      path: f.path, // path is usually a string, relative to the torrent root
      length: f.length,
      offset: f.offset
    }));
    this.dirHandle = dirHandle;
    this.fileHandles = new Map();
  }

  async getFileHandle(filePath: string) {
    if (this.fileHandles.has(filePath)) {
      return this.fileHandles.get(filePath)!;
    }
    const parts = filePath.split(/[\\/]/);
    let currentDir = this.dirHandle;
    
    // Create folders if they don't exist
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1], { create: true });
    this.fileHandles.set(filePath, fileHandle);
    return fileHandle;
  }

  put(index: number, chunkBuffer: Buffer | Uint8Array, cb: (err?: Error | null) => void) {
    const chunkStart = index * this.chunkLength;
    const chunkEnd = chunkStart + chunkBuffer.length;
    
    const overlappingFiles = this.files.filter(f => {
      const fileStart = f.offset;
      const fileEnd = fileStart + f.length;
      return chunkStart < fileEnd && chunkEnd > fileStart;
    });

    const isBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(chunkBuffer);
    const u8Array = isBuffer ? chunkBuffer : new Uint8Array(chunkBuffer as any);

    Promise.all(overlappingFiles.map(async f => {
      const fileStart = f.offset;
      const fileEnd = fileStart + f.length;

      const overlapStart = Math.max(chunkStart, fileStart);
      const overlapEnd = Math.min(chunkEnd, fileEnd);

      const chunkSliceStart = overlapStart - chunkStart;
      const chunkSliceEnd = overlapEnd - chunkStart;
      
      const dataToWrite = u8Array.slice(chunkSliceStart, chunkSliceEnd);
      const filePosition = overlapStart - fileStart;

      const handle = await this.getFileHandle(f.path);
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', position: filePosition, data: dataToWrite });
      await writable.close();
    })).then(() => cb(null)).catch(err => {
      console.error('FSChunkStore write error:', err);
      cb(err);
    });
  }

  get(index: number, opts: any, cb: (err: Error | null, buf?: Uint8Array) => void) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = null;
    }
    
    const chunkStart = index * this.chunkLength;
    const chunkLen = (opts && opts.length) ? opts.length : this.chunkLength;
    const chunkEnd = Math.min(chunkStart + chunkLen, this.length);
    const actualChunkLength = chunkEnd - chunkStart;

    const buffer = new Uint8Array(actualChunkLength);
    
    const overlappingFiles = this.files.filter(f => {
      return chunkStart < (f.offset + f.length) && chunkEnd > f.offset;
    });

    (async () => {
      for (const f of overlappingFiles) {
        const fileStart = f.offset;
        const fileEnd = fileStart + f.length;

        const overlapStart = Math.max(chunkStart, fileStart);
        const overlapEnd = Math.min(chunkEnd, fileEnd);

        const filePosition = overlapStart - fileStart;
        const bufferPosition = overlapStart - chunkStart;
        const bytesToRead = overlapEnd - overlapStart;

        const handle = await this.getFileHandle(f.path);
        const file = await handle.getFile();
        const slice = file.slice(filePosition, filePosition + bytesToRead);
        const arrayBuffer = await slice.arrayBuffer();
        buffer.set(new Uint8Array(arrayBuffer), bufferPosition);
      }
      cb(null, buffer);
    })().catch(err => {
      cb(err);
    });
  }

  close(cb: (err?: Error | null) => void) {
    cb(null);
  }

  destroy(cb: (err?: Error | null) => void) {
    cb(null);
  }
}

export function makeFSChunkStore(dirHandle: FileSystemDirectoryHandle) {
  return function (chunkLength: number, storeOpts: any) {
    return new FSChunkStore(chunkLength, storeOpts, dirHandle);
  };
}
