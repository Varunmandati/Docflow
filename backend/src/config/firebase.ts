import { initializeApp, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { logger } from './logger.js';
import { env } from './env.js';

let firebaseApp: App | undefined;

export function initializeFirebaseAdmin() {
    if (firebaseApp) return firebaseApp;

    try {
        if (!env.FIREBASE_SERVICE_ACCOUNT) {
            logger.warn('FIREBASE_SERVICE_ACCOUNT is not set. Firebase Admin functionality (auth verification) will fail.');
            return;
        }

        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);

        firebaseApp = initializeApp({
            credential: cert(serviceAccount)
        });
        
        logger.info('Firebase Admin initialized successfully');
        return firebaseApp;
    } catch (error) {
        logger.error({ err: error }, 'Failed to initialize Firebase Admin');
        // Don't crash immediately so the server can start, but auth routes will fail.
    }
}

export function getFirebaseAdmin() {
    return firebaseApp;
}
