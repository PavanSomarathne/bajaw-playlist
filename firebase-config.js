// Firebase web configuration is public by design. Firestore security rules
// control access to your data. Replace these placeholders with the values from
// Firebase Console > Project settings > Your apps > Web app.
export const firebaseConfig = {
  apiKey: "AIzaSyBmY2f_VGqxvOHLaZACq-dH_CaQjJqYAWA",
  authDomain: "bajaw-playlist-d0380.firebaseapp.com",
  projectId: "bajaw-playlist-d0380",
  storageBucket: "bajaw-playlist-d0380.firebasestorage.app",
  messagingSenderId: "796280753140",
  appId: "1:796280753140:web:5f72995ce18f6364f8c7a1",
};

export function hasFirebaseConfig() {
  return Object.values(firebaseConfig).every(
    (value) => value && !value.startsWith("REPLACE_WITH_"),
  );
}
