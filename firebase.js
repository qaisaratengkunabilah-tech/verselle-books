
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// VERSÉLLE BOOKS FIREBASE CONFIGURATION
const firebaseConfig = {
  apiKey: "PASTE_YOUR_FIREBASE_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const isConfigured =
  firebaseConfig.apiKey !== "PASTE_YOUR_FIREBASE_API_KEY" &&
  firebaseConfig.projectId !== "PASTE_YOUR_PROJECT_ID";

let auth = null;
let db = null;
let firebaseReady = false;

function safeDocId(key) {
  return String(key || "book")
    .replaceAll("/", "_")
    .replaceAll(".", "_");
}

// INITIALIZE FIREBASE
if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);

    auth = getAuth(app);
    db = getFirestore(app);

    firebaseReady = true;

    console.info("Versélle Books Firebase initialized.");

  } catch (error) {
    console.error("Firebase initialization failed:", error);
  }
}

// USER AUTHENTICATION
function waitForUser() {
  if (!firebaseReady || !auth) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let unsubscribe = null;

    unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (unsubscribe) unsubscribe();

        if (user) {
          resolve(user);
          return;
        }

        try {
          const credential = await signInAnonymously(auth);
          resolve(credential.user);

        } catch (error) {
          console.error("Anonymous sign-in failed:", error);
          resolve(null);
        }
      }
    );
  });
}

// GET FAVOURITE BOOKS
async function getCloudFavorites(user) {
  if (!db || !user) return [];

  const snapshot = await getDocs(
    collection(db, "users", user.uid, "favorites")
  );

  return snapshot.docs.map((item) => item.data());
}

// SAVE FAVOURITE BOOK
async function saveCloudFavorite(user, book) {
  if (!db || !user) return;

  await setDoc(
    doc(
      db,
      "users",
      user.uid,
      "favorites",
      safeDocId(book.key)
    ),
    book
  );
}

// REMOVE FAVOURITE BOOK
async function removeCloudFavorite(user, bookKey) {
  if (!db || !user) return;

  await deleteDoc(
    doc(
      db,
      "users",
      user.uid,
      "favorites",
      safeDocId(bookKey)
    )
  );
}

export {
  firebaseReady,
  waitForUser,
  getCloudFavorites,
  saveCloudFavorite,
  removeCloudFavorite
};
