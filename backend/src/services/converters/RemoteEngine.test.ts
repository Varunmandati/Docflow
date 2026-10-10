import { describe, it, expect } from 'vitest';
import { selectRemoteProvider, tsvToCsv } from './RemoteEngine';
import { mapCloudConvertFormat } from './CloudConvertEngine';

describe('selectRemoteProvider (category routing)', () => {
    it('routes all audio pairs to cloudconvert', () => {
        expect(selectRemoteProvider('mp3', 'wav')).toBe('cloudconvert');
        expect(selectRemoteProvider('wav', 'm4a')).toBe('cloudconvert');
        expect(selectRemoteProvider('flac', 'ogg')).toBe('cloudconvert');
        expect(selectRemoteProvider('aac', 'mp3')).toBe('cloudconvert');
    });

    it('routes all video pairs to cloudconvert, including video->audio and video->gif', () => {
        expect(selectRemoteProvider('mp4', 'mov')).toBe('cloudconvert');
        expect(selectRemoteProvider('mkv', 'webm')).toBe('cloudconvert');
        expect(selectRemoteProvider('mp4', 'mp3')).toBe('cloudconvert');
        expect(selectRemoteProvider('mov', 'gif')).toBe('cloudconvert');
        expect(selectRemoteProvider('avi', 'mkv')).toBe('cloudconvert');
    });

    it('routes 7z pairs to cloudconvert (ConvertAPI has no archive<->archive)', () => {
        expect(selectRemoteProvider('zip', '7z')).toBe('cloudconvert');
        expect(selectRemoteProvider('7z', 'zip')).toBe('cloudconvert');
        expect(selectRemoteProvider('tar', '7z')).toBe('cloudconvert');
        expect(selectRemoteProvider('7z', 'tar.gz')).toBe('cloudconvert');
    });

    it('routes documents, pdf and images to convertapi', () => {
        expect(selectRemoteProvider('docx', 'pdf')).toBe('convertapi');
        expect(selectRemoteProvider('pdf', 'docx')).toBe('convertapi');
        expect(selectRemoteProvider('pdf', 'jpg')).toBe('convertapi');
        expect(selectRemoteProvider('png', 'pdf')).toBe('convertapi');
        expect(selectRemoteProvider('tsv', 'pdf')).toBe('convertapi');
        expect(selectRemoteProvider('avif', 'pdf')).toBe('convertapi');
        expect(selectRemoteProvider('svg', 'pdf')).toBe('convertapi');
        expect(selectRemoteProvider('epub', 'pdf')).toBe('convertapi');
    });
});

describe('tsvToCsv', () => {
    it('converts tabs to commas', () => {
        expect(tsvToCsv('a\tb\tc\n1\t2\t3')).toBe('a,b,c\r\n1,2,3');
    });

    it('quotes fields containing commas, quotes and newlines', () => {
        expect(tsvToCsv('a\tb,c')).toBe('a,"b,c"');
        expect(tsvToCsv('a\tb"c')).toBe('a,"b""c"');
    });

    it('drops a single trailing empty line', () => {
        expect(tsvToCsv('a\tb\n')).toBe('a,b');
        expect(tsvToCsv('a\tb\n\n')).toBe('a,b\r\n');
    });
});

describe('mapCloudConvertFormat', () => {
    it('aliases tar.gz to tgz and passes everything else through', () => {
        expect(mapCloudConvertFormat('tar.gz')).toBe('tgz');
        expect(mapCloudConvertFormat('zip')).toBe('zip');
        expect(mapCloudConvertFormat('mp3')).toBe('mp3');
        expect(mapCloudConvertFormat('mkv')).toBe('mkv');
    });
});
