// Firebase Auth + Firestore utilities for Clario (ES Module)
// SDK: v10 modular, imported from gstatic CDN
// 1) Replace the firebaseConfig below with your project's Web App config.
// 2) Include this file with: <script type="module" src="/auth.js"></script>
// 3) From pages, import needed functions: import { guardPage, signInWithGoogle, ... } from '/auth.js';

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  initializeFirestore,
  enableNetwork,
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// --- Replace this config with your real Firebase Web App config for project clario-2c575 ---
// You can find it in Firebase Console: Project settings → Your apps → Web app → SDK setup and configuration
const firebaseConfig = (window.FIREBASE_CONFIG) || {
  apiKey: "AIzaSyBli9-k750C9m9dDmd8fPc-1fFeMoiuTcA",
  authDomain: "clario-2c575.firebaseapp.com",
  projectId: "clario-2c575",
  storageBucket: "clario-2c575.appspot.com",
  messagingSenderId: "319422952944",
  appId: "1:319422952944:web:429399b0a681df914c5935",
  measurementId: "G-SGH0RSBWRL"
};

// Initialize Firebase (guard against double init)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
// Initialize Firestore with the most compatible transport (force long-polling)
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

// Persist session
await setPersistence(auth, browserLocalPersistence);

// After auth is ready, ensure Firestore network is enabled
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try { await enableNetwork(db); } catch(_) {}
  }
});

// Helpers
function savePostLogin(path){
  try { sessionStorage.setItem('postLogin', path); } catch(_) {}
}
function consumePostLogin(){
  try {
    const p = sessionStorage.getItem('postLogin');
    if(p) sessionStorage.removeItem('postLogin');
    return p || null;
  } catch(_) { return null; }
}

export function guardPage(){
  onAuthStateChanged(auth, (user) => {
    if(!user){
      const path = location.pathname + location.search + location.hash;
      savePostLogin(path);
      location.href = '/signin';
    }
  });
}

// Waits for Auth resolution before executing callback
export function onReady(cb){
  onAuthStateChanged(auth, (user) => cb(user));
}

export async function ensureUserDoc(user){
  if(!user) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, {
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      plan: 'free',
      imageCredits: 10,
      previewCredits: 1,
      hdCredits: 0,
      createdAt: Date.now()
    });
  } else {
    // Update profile info on each signin
    await setDoc(ref, {
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      email: user.email || null
    }, { merge: true });

    // Migrate legacy field: videoPreviewCredits -> previewCredits (non-destructive)
    try {
      const data = snap.data();
      if (data && data.previewCredits === undefined && typeof data.videoPreviewCredits === 'number') {
        await setDoc(ref, { previewCredits: data.videoPreviewCredits }, { merge: true });
      }
    } catch (_) { /* ignore */ }
  }
}

export async function signInWithGoogle(){
  const provider = new GoogleAuthProvider();
  try {
    // Use popup for immediate sign-in without redirect loops
    const result = await signInWithPopup(auth, provider);
    await ensureUserDoc(result.user);
    return result.user;
  } catch (error) {
    // If popup is blocked, fall back to redirect
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      console.log('Popup blocked, falling back to redirect');
      await signInWithRedirect(auth, provider);
    } else {
      throw error;
    }
  }
}

// Finalize Google redirect on pages like /signin
export async function completeRedirect(){
  try {
    const res = await getRedirectResult(auth);
    if (res?.user) {
      await ensureUserDoc(res.user);
    }
  } catch(_) {}
}

export async function signInWithGitHub(){
  const provider = new GithubAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function emailSignIn(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function emailSignUp(email, password){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function resetPassword(email){
  await sendPasswordResetEmail(auth, email);
}

export function redirectAfterLogin(){
  const target = consumePostLogin() || '/';
  location.href = target;
}

export { app, auth, db };

// Expose a global helper for other pages to obtain the ID token when needed.
// Example usage: const token = await window.clarioGetIdToken?.();
try{
  // eslint-disable-next-line no-undef
  window.clarioGetIdToken = async () => {
    const u = auth.currentUser;
    return u ? await u.getIdToken() : null;
  };
}catch(_){ /* ignore if window not available */ }
