/* ------------------------------------------------------------------ *
 *  Firebase connection (Google sign-in, Firestore, Cloud Functions).
 *
 *  The values below are the web-app config of the Firebase project. They are
 *  identifiers, not secrets: access is enforced by firestore.rules and by the
 *  Cloud Functions, never by hiding these. When they are not set (for example
 *  a fresh clone) FIREBASE_ENABLED is false and the site falls back to the
 *  browser-only demo data, so it keeps working.
 *
 *  Firebase is imported lazily, so visitors who never sign in or register do
 *  not download it and the entry screen is not slowed down.
 * ------------------------------------------------------------------ */
import type { FirebaseApp } from 'firebase/app';

const env = import.meta.env;

export const FIREBASE_ENABLED = !!(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);
export const FUNCTIONS_REGION: string = env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-south1';

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string,
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string,
  appId: env.VITE_FIREBASE_APP_ID as string,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined
};

let appPromise: Promise<FirebaseApp> | null = null;

export const getApp = (): Promise<FirebaseApp> => {
  if (!FIREBASE_ENABLED) return Promise.reject(new Error('Firebase is not configured'));
  appPromise ??= (async () => {
    const { initializeApp } = await import('firebase/app');
    const app = initializeApp(config);
    // Optional App Check (reCAPTCHA v3): lets the backend refuse traffic that does not come from this site.
    const siteKey = env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
    if (siteKey) {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
    }
    return app;
  })();
  return appPromise;
};

export const getAuthModule = async () => {
  const [app, mod] = await Promise.all([getApp(), import('firebase/auth')]);
  return { auth: mod.getAuth(app), mod };
};

export const getFirestoreModule = async () => {
  const [app, mod] = await Promise.all([getApp(), import('firebase/firestore')]);
  return { db: mod.getFirestore(app), mod };
};

export const getFunctionsModule = async () => {
  const [app, mod] = await Promise.all([getApp(), import('firebase/functions')]);
  return { fns: mod.getFunctions(app, FUNCTIONS_REGION), mod };
};
