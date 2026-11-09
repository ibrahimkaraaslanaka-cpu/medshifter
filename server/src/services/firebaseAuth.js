const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getAuth: firebaseGetAuth } = require('firebase-admin/auth');

function getAuth() {
    if (!process.env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is required');
    if (!getApps().length) {
        initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID, credential: applicationDefault() });
    }
    return firebaseGetAuth();
}

module.exports = { getAuth };
