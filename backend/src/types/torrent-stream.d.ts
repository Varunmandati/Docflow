declare module 'torrent-stream' {
    import { Stream } from 'stream';

    interface TorrentFile {
        name: string;
        length: number;
        path: string;
        createReadStream(opts?: any): Stream;
    }

    interface Engine {
        files: TorrentFile[];
        on(event: string, callback: Function): void;
        destroy(): void;
    }

    function torrentStream(
        torrent: string | Buffer,
        opts?: {
            connections?: number;
            uploads?: number;
            tmp?: string;
        }
    ): Engine;

    export = torrentStream;
}
