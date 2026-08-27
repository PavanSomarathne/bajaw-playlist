# Bajaw Playlist

A static GitHub Pages frontend backed by Firebase Authentication and Cloud Firestore.

## Firebase setup

1. Create a Firebase project and register a Web app.
2. In **Authentication → Sign-in method**, enable Google.
3. In **Authentication → Settings → Authorized domains**, add the GitHub Pages hostname used by this repository.
4. Create a Cloud Firestore database.
5. Copy the Web app configuration into `firebase-config.js`.
6. Install the Firebase CLI, authenticate, and associate this directory with the project:

   ```sh
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules
   ```

7. Commit and push the files so GitHub Pages publishes the frontend.

The Firebase web configuration is not a secret. Public reads and authenticated writes are enforced by `firestore.rules`.

## Local preview

ES modules require an HTTP server; opening `index.html` directly is not supported. Run any static server in the repository, for example:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Add `localhost` to Firebase Authentication's authorized domains for local sign-in.
