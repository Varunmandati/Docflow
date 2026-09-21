import { firebaseAuth } from '../firebase';
import { signInWithCustomToken } from 'firebase/auth';

const TOKEN_KEY = 'authToken';
const CUSTOM_TOKEN_KEY = 'customToken';

const getToken = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const setToken = (key: string, value: string | null): void => {
    try {
        if (value) {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    } catch {
        // ignore storage failures
    }
};

const decodeExpiry = (token: string): number | null => {
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(normalized));
        return typeof json.exp === 'number' ? json.exp * 1000 : null;
    } catch {
        return null;
    }
};

const isExpiredOrExpiring = (token: string): boolean => {
    const exp = decodeExpiry(token);
    if (exp === null) return false;
    // Refresh if the token expires within the next 60 seconds.
    return exp - Date.now() < 60_000;
};

// Re-signs in with the persisted custom token and stores a fresh ID token.
// This works even after a page reload / browser restart, because the custom
// token lives in localStorage.
const reExchangeCustomToken = async (): Promise<string | null> => {
    const customToken = getToken(CUSTOM_TOKEN_KEY);
    if (!customToken || !firebaseAuth) return null;
    try {
        const creds = await signInWithCustomToken(firebaseAuth, customToken);
        const idToken = await creds.user.getIdToken();
        setToken(TOKEN_KEY, idToken);
        return idToken;
    } catch {
        return null;
    }
};

const refreshViaFirebase = async (): Promise<string | null> => {
    if (firebaseAuth?.currentUser) {
        try {
            const idToken = await firebaseAuth.currentUser.getIdToken(true);
            setToken(TOKEN_KEY, idToken);
            return idToken;
        } catch {
            // fall through to custom-token re-exchange
        }
    }
    return reExchangeCustomToken();
};

// Returns a valid (non-expiring) token, refreshing it via Firebase or the
// persisted custom token if the stored one is stale.
export const getValidAuthToken = async (): Promise<string | null> => {
    const token = getToken(TOKEN_KEY);
    if (!token) return null;
    if (isExpiredOrExpiring(token)) {
        const fresh = await refreshViaFirebase();
        if (fresh) return fresh;
    }
    return token;
};

export async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getValidAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const authFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    // If the caller already built a full URL (via buildApiUrl), do NOT
    // prepend the base again — that would double the origin in production.
    const fullUrl = (url.startsWith('http://') || url.startsWith('https://'))
        ? url
        : `${API_BASE_URL}${url}`;
    const attach = async () => {
        const token = await getValidAuthToken();
        return {
            ...(init.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
    };

    let response = await fetch(fullUrl, {
        ...init,
        headers: await attach(),
    });

    // Token may have been revoked or expired mid-flight; refresh once and retry.
    if (response.status === 401) {
        const fresh = await refreshViaFirebase();
        if (fresh) {
            response = await fetch(fullUrl, {
                ...init,
                headers: {
                    ...(init.headers || {}),
                    Authorization: `Bearer ${fresh}`,
                },
            });
        }
    }

    return response;
};



