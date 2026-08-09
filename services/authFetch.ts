const getAuthToken = (): string | null => {
    try {
        return localStorage.getItem('authToken');
    } catch {
        return null;
    }
};

export function getAuthHeaders(): Record<string, string> {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export const authFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
    fetch(url, {
        ...init,
        headers: {
            ...getAuthHeaders(),
            ...(init.headers || {}),
        },
    });