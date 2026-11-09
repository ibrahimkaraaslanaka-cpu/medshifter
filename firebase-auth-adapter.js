/* Firebase Auth bridge for pages that still use the existing session interface. */
(function () {
    let client;

    function initialize() {
        if (client) return client;
        const config = window.AppConfig?.FIREBASE_CONFIG;
        if (!config?.apiKey || !config?.projectId || !config?.appId) {
            throw new Error('Firebase application configuration is missing');
        }
        if (!window.firebase?.auth) throw new Error('Firebase Auth SDK did not load');
        const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(config);
        const auth = app.auth();

        async function session() {
            await new Promise((resolve, reject) => {
                let unsubscribe = () => {};
                unsubscribe = auth.onAuthStateChanged(() => { unsubscribe(); resolve(); }, reject);
            });
            if (!auth.currentUser) return null;
            return { access_token: await auth.currentUser.getIdToken(), user: auth.currentUser };
        }

        async function result(action) {
            try { return { data: await action(), error: null }; }
            catch (error) { return { data: null, error }; }
        }

        client = { auth: {
            async getSession() {
                return result(async () => ({ session: await session() }));
            },
            async signInWithPassword({ email, password }) {
                return result(async () => {
                    const credential = await auth.signInWithEmailAndPassword(email, password);
                    if (!credential.user.emailVerified) {
                        await auth.signOut();
                        throw new Error('E-posta adresinizi doğrulayın. Onay bağlantısı gelen kutunuzda.');
                    }
                    return { user: credential.user, session: await session() };
                });
            },
            async signUp({ email, password, options }) {
                return result(async () => {
                    const credential = await auth.createUserWithEmailAndPassword(email, password);
                    try {
                        const name = options?.data?.full_name || options?.data?.name;
                        if (name) await credential.user.updateProfile({ displayName: name });
                        await credential.user.sendEmailVerification({
                            url: options?.emailRedirectTo || window.location.origin + '/login.html'
                        });
                    } finally {
                        await auth.signOut();
                    }
                    return { user: credential.user, session: null };
                });
            },
            async signInWithIdToken({ provider, token }) {
                return result(async () => {
                    if (provider !== 'google') throw new Error('Unsupported sign-in provider');
                    const googleCredential = window.firebase.auth.GoogleAuthProvider.credential(token);
                    const credential = await auth.signInWithCredential(googleCredential);
                    return { user: credential.user, session: await session() };
                });
            },
            async signOut() { return result(async () => { await auth.signOut(); return {}; }); },
            onAuthStateChange(callback) {
                let previousUid;
                const unsubscribe = auth.onIdTokenChanged(async user => {
                    try {
                        const currentSession = user ? await session() : null;
                        const event = !user ? 'SIGNED_OUT'
                            : previousUid === user.uid ? 'TOKEN_REFRESHED' : 'SIGNED_IN';
                        previousUid = user?.uid;
                        callback(event, currentSession);
                    } catch (error) { console.error('Auth state update failed', error); }
                });
                return { data: { subscription: { unsubscribe } } };
            }
        } };
        return client;
    }

    window.FirebaseAuthAdapter = { createClient: initialize };
})();
