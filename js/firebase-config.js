import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, query, where, increment, runTransaction, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithCredential } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyBzePsRjC7pvnLQNxqUhHI5tuTndc9ggek",
  authDomain: "didisbiryani-876ca.firebaseapp.com",
  projectId: "didisbiryani-876ca",
  storageBucket: "didisbiryani-876ca.firebasestorage.app",
  messagingSenderId: "455024925550",
  appId: "1:455024925550:web:1fc4006674d7e6147cbf7f",
  measurementId: "G-HR95B9XHDK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const functions = getFunctions(app);
const messaging = getMessaging(app);

// Smart Auth Helper: Popups are blocked by default on iOS Safari / Mobile.
// Fallback gracefully from popup to redirect if popup blocker or cross-window tracking blocks popups.
const signInWithGoogle = async (auth, provider) => {
  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
      console.warn("Popup blocked, falling back to redirect:", error);
      return await signInWithRedirect(auth, provider);
    }
    throw error;
  }
};

export { db, auth, provider, signInWithPopup, signInWithGoogle, getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, signInWithCredential, collection, addDoc, getDocs, getDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, query, where, increment, runTransaction, arrayUnion, functions, httpsCallable, messaging, getToken, onMessage };
