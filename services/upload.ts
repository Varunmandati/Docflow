import { authFetch } from './authFetch';

/**
 * Upload a file through the backend, preferring the presigned direct-to-R2
 * flow and falling back to the classic multipart POST whenever presign is
 * unavailable or fails.
 *
 * Why: serverless platforms cap request bodies (~4.5MB on Vercel), so large
 * files must go straight to object storage via a presigned PUT URL. Disk-mode
 * deployments don't have that flow and answer 501 from /v1/files/presign —
 * the fallback keeps them byte-for-byte identical to before.
 *
 * The returned Response always mirrors the classic upload contract (status
 * codes, `{fileId, name, size, mimeType, createdAt}` JSON), so call sites keep
 * their existing error handling — including the 401 sign-in branch.
 */
export async function uploadWithPresignFallback(
    file: File,
    presignUrl: string,
    fallbackUploadUrl: string
): Promise<Response> {
    try {
        const presignRes = await authFetch(presignUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: file.name,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
            }),
        });

        if (presignRes.ok) {
            const { uploadUrl, completeUrl } = (await presignRes.json()) as {
                fileId: string;
                uploadUrl: string;
                completeUrl: string;
            };

            // Direct PUT to R2. The presigned URL is the credential, so this
            // one request intentionally skips authFetch (no bearer header, no
            // API-base rewriting — uploadUrl is already absolute).
            const putRes = await fetch(uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
                body: file,
            });

            if (putRes.ok) {
                const completeRes = await authFetch(completeUrl, { method: 'POST' });
                if (completeRes.ok) {
                    return completeRes;
                }
            }
        }
        // Any non-ok presign/PUT/complete falls through to the classic path so
        // the error surface matches pre-serverless deployments exactly.
    } catch {
        // Network blip on the presign leg — the classic upload gets the retry.
    }

    const uploadForm = new FormData();
    uploadForm.append('file', file, file.name);
    return authFetch(fallbackUploadUrl, { method: 'POST', body: uploadForm });
}
