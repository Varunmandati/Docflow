/**
 * Minimal response helper shared by the serverless function entrypoints
 * (api/*). Kept dependency-free so the functions don't need @vercel/node
 * types at compile time.
 */
export interface BareResponse {
    statusCode?: number;
    setHeader(name: string, value: string): void;
    end(chunk?: unknown): void;
}

export function sendJson(res: BareResponse, statusCode: number, body: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}
