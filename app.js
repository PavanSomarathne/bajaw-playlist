import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "./firebase-config.js";

const BEATS = ["4/4", "3/4", "2/4", "6/8"];
const POSITION_STEP = 1024;
const MAX_BATCH_SONGS = 450;

const $ = (selector) => document.querySelector(selector);
const elements = {
  add: $("#add"),
  auth: $("#authButton"),
  authLabel: $("#authLabel"),
  dialog: $("#dialog"),
  empty: $("#empty"),
  emptyTitle: $("#emptyTitle"),
  emptyText: $("#emptyText"),
  favoriteCount: $("#favs"),
  filter: $("#filter"),
  form: $("#form"),
  grid: $("#grid"),
  result: $("#result"),
  search: $("#search"),
  songCount: $("#songs"),
  sourceCount: $("#sources"),
  status: $("#appStatus"),
  toast: $("#toast"),
};

const icons = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M8 11v6M12 11v6M16 11v6M6 7l1 14h10l1-14"/></svg>',
};

const localStore = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The interface still works if browser storage is unavailable.
    }
  },
};

let auth;
let db;
let currentUser = null;
let songs = [];
let loadedOnce = false;
let draggedId = null;
let touchTargetId = null;
let unsubscribeSongs = null;
let view = localStore.get("bajaw-view", "grid");

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function domain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Chord source";
  }
}

function sourceLabel(url) {
  return {
    "alachords.com": "Ala Chords",
    "chordslankalk.com": "Chords Lanka",
    "chordssrilanka.com": "Chords Sri Lanka",
    "sinhalasongbook.com": "Sinhala Song Book",
  }[domain(url)] || domain(url);
}

function setStatus(message = "", type = "") {
  elements.status.textContent = message;
  elements.status.className = `status-banner${type ? ` ${type}` : ""}`;
  elements.status.hidden = !message;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function errorMessage(error, fallback) {
  const messages = {
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/unauthorized-domain": "This domain is not authorized in Firebase Authentication.",
    "permission-denied": "You do not have permission to make that change.",
    "unavailable": "Firebase is temporarily unavailable. Try again shortly.",
  };
  return messages[error?.code] || fallback;
}

function visibleSongs() {
  const search = elements.search.value.trim().toLowerCase();
  const filter = elements.filter.value;

  return songs.filter((song) => {
    const matchesSearch = `${song.title} ${song.singer} ${domain(song.chordUrl)}`
      .toLowerCase()
      .includes(search);
    const matchesFilter = filter === "all"
      || (filter === "favorites" && song.favorite)
      || (filter.startsWith("beat:") && song.beat === filter.slice(5));
    return matchesSearch && matchesFilter;
  });
}

function renderAuth() {
  const signedIn = Boolean(currentUser);
  elements.auth.classList.toggle("signed-in", signedIn);
  elements.auth.setAttribute("aria-label", signedIn ? "Sign out" : "Sign in with Google");
  elements.auth.title = signedIn ? `Signed in as ${currentUser.displayName || currentUser.email}` : "Sign in with Google";
  elements.authLabel.textContent = signedIn ? (currentUser.displayName?.split(" ")[0] || "Sign out") : "Sign in";
  elements.add.disabled = !signedIn;
  elements.add.title = signedIn ? "Add song" : "Sign in to add songs";
}

function renderEmpty(shownCount) {
  if (!loadedOnce) {
    elements.emptyTitle.textContent = "Loading your songbook…";
    elements.emptyText.textContent = "Connecting to the shared playlist.";
  } else if (!songs.length) {
    elements.emptyTitle.textContent = "Your shared playlist is empty";
    elements.emptyText.textContent = currentUser
      ? "Add the first song to start the library."
      : "Sign in with Google to add the first song.";
  } else {
    elements.emptyTitle.textContent = "No songs found";
    elements.emptyText.textContent = "Try a different song, singer, or beat.";
  }
  elements.empty.classList.toggle("visible", shownCount === 0);
}

function render() {
  const shown = visibleSongs();
  const canEdit = Boolean(currentUser);

  elements.grid.innerHTML = shown.map((song) => `
    <article class="song-card" data-id="${song.id}" data-letter="${escapeHtml(song.title.charAt(0).toUpperCase())}">
      <div class="card-top">
        <div class="card-tools">
          <button class="drag-handle" draggable="${canEdit}" ${canEdit ? "" : "disabled"} aria-label="${canEdit ? `Drag to reorder ${escapeHtml(song.title)}` : "Sign in to reorder songs"}" title="${canEdit ? "Drag to reorder" : "Sign in to reorder"}">${icons.grip}</button>
          <span class="beat">${escapeHtml(song.beat)}</span>
          <span class="source">${escapeHtml(sourceLabel(song.chordUrl))}</span>
        </div>
        <button class="favorite ${song.favorite ? "active" : ""}" data-favorite="${song.id}" ${canEdit ? "" : "disabled"} aria-label="${canEdit ? "Toggle favorite" : "Sign in to change favorites"}" aria-pressed="${song.favorite}">${icons.heart}</button>
      </div>
      <div class="song-copy">
        <h3 class="song-title">${escapeHtml(song.title)}</h3>
        <p class="song-meta"><span class="singer">${escapeHtml(song.singer)}</span></p>
      </div>
      <div class="card-actions">
        <a class="open-link" href="${escapeHtml(song.chordUrl)}" target="_blank" rel="noopener noreferrer">Open chords ${icons.arrow}</a>
        ${canEdit ? `<button class="delete" data-delete="${song.id}" aria-label="Delete ${escapeHtml(song.title)}">${icons.trash}</button>` : ""}
      </div>
    </article>
  `).join("");

  renderEmpty(shown.length);
  elements.result.textContent = shown.length === songs.length
    ? `${songs.length} ${songs.length === 1 ? "song" : "songs"}${canEdit && songs.length ? " · Drag to reorder" : ""}`
    : `${shown.length} of ${songs.length} songs`;
  elements.songCount.textContent = songs.length;
  elements.favoriteCount.textContent = songs.filter((song) => song.favorite).length;
  elements.sourceCount.textContent = new Set(songs.map((song) => domain(song.chordUrl))).size;
}

function requireEditor() {
  if (currentUser) return true;
  showToast("Sign in with Google to edit the playlist.");
  return false;
}

async function toggleFavorite(songId) {
  if (!requireEditor()) return;
  const song = songs.find((item) => item.id === songId);
  if (!song) return;

  try {
    await updateDoc(doc(db, "songs", songId), {
      favorite: !song.favorite,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
    });
  } catch (error) {
    showToast(errorMessage(error, "Could not update the favorite."));
  }
}

async function removeSong(songId) {
  if (!requireEditor()) return;
  const song = songs.find((item) => item.id === songId);
  if (!song || !window.confirm(`Delete “${song.title}” from the shared playlist?`)) return;

  try {
    await deleteDoc(doc(db, "songs", songId));
    showToast("Song removed from the shared playlist.");
  } catch (error) {
    showToast(errorMessage(error, "Could not remove the song."));
  }
}

function clearDragStyles() {
  document.querySelectorAll(".dragging,.drag-over").forEach((card) => {
    card.classList.remove("dragging", "drag-over");
  });
}

async function reorderSongs(fromId, toId) {
  if (!requireEditor() || !fromId || !toId || fromId === toId) return;
  if (songs.length > MAX_BATCH_SONGS) {
    showToast("This playlist is too large to reorder in one operation.");
    return;
  }

  const previousSongs = [...songs];
  const reordered = [...songs];
  const fromIndex = reordered.findIndex((song) => song.id === fromId);
  const toIndex = reordered.findIndex((song) => song.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;

  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  songs = reordered;
  render();

  try {
    const batch = writeBatch(db);
    reordered.forEach((song, index) => {
      batch.update(doc(db, "songs", song.id), {
        position: index * POSITION_STEP,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
      });
    });
    await batch.commit();
    showToast("Playlist order updated.");
  } catch (error) {
    songs = previousSongs;
    render();
    showToast(errorMessage(error, "Could not save the new order."));
  }
}

async function handleSignIn() {
  if (!auth) return;
  if (currentUser) {
    try {
      await signOut(auth);
      showToast("Signed out.");
    } catch (error) {
      showToast(errorMessage(error, "Could not sign out."));
    }
    return;
  }

  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
      await signInWithRedirect(auth, new GoogleAuthProvider());
      return;
    }
    showToast(errorMessage(error, "Could not sign in with Google."));
  }
}

function subscribeToSongs() {
  const songsQuery = query(collection(db, "songs"), orderBy("position", "asc"));
  unsubscribeSongs = onSnapshot(
    songsQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      songs = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      loadedOnce = true;
      render();

      if (!navigator.onLine) {
        setStatus("You are offline. Showing the last available playlist.", "offline");
      } else if (snapshot.metadata.fromCache && songs.length) {
        setStatus("Showing cached songs while reconnecting…", "offline");
      } else {
        setStatus();
      }
    },
    (error) => {
      loadedOnce = true;
      render();
      setStatus(errorMessage(error, "Could not connect to the shared playlist."), "error");
    },
  );
}

function initializeFirebase() {
  if (!hasFirebaseConfig()) {
    loadedOnce = true;
    elements.auth.disabled = true;
    setStatus("Firebase setup is required. Add your project values to firebase-config.js.", "error");
    renderAuth();
    render();
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      // Fall back to the in-memory cache if IndexedDB is unavailable.
      db = getFirestore(app);
    }

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      renderAuth();
      render();
    });
    subscribeToSongs();
  } catch (error) {
    loadedOnce = true;
    elements.auth.disabled = true;
    setStatus("Firebase could not start. Check firebase-config.js and reload.", "error");
    renderAuth();
    render();
  }
}

elements.search.addEventListener("input", render);
elements.filter.addEventListener("change", render);
elements.auth.addEventListener("click", handleSignIn);
elements.add.addEventListener("click", () => {
  if (requireEditor()) elements.dialog.showModal();
});
$("#close").addEventListener("click", () => elements.dialog.close());
$("#cancel").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireEditor()) return;

  const data = new FormData(elements.form);
  const beat = data.get("beat");
  const title = data.get("title").trim();
  const singer = data.get("singer").trim();
  const chordUrl = data.get("url").trim();
  const submitButton = elements.form.querySelector('[type="submit"]');
  if (!BEATS.includes(beat)) {
    showToast("Choose a supported beat.");
    return;
  }
  if (!title || !singer) {
    showToast("Enter both the song title and singer.");
    return;
  }
  try {
    if (new URL(chordUrl).protocol !== "https:") throw new Error("Invalid protocol");
  } catch {
    showToast("Enter a valid HTTPS chord link.");
    return;
  }

  submitButton.disabled = true;
  try {
    const maxPosition = songs.reduce((maximum, song) => Math.max(maximum, song.position), -POSITION_STEP);
    await addDoc(collection(db, "songs"), {
      beat,
      chordUrl,
      createdAt: serverTimestamp(),
      favorite: false,
      position: maxPosition + POSITION_STEP,
      singer,
      title,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
    });
    elements.form.reset();
    elements.form.querySelector('[name="beat"][value="4/4"]').checked = true;
    elements.dialog.close();
    elements.filter.value = "all";
    showToast("Song added to the shared playlist.");
  } catch (error) {
    showToast(errorMessage(error, "Could not add the song."));
  } finally {
    submitButton.disabled = false;
  }
});

elements.grid.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    toggleFavorite(favorite.dataset.favorite);
    return;
  }
  const remove = event.target.closest("[data-delete]");
  if (remove) removeSong(remove.dataset.delete);
});

elements.grid.addEventListener("dragstart", (event) => {
  const handle = event.target.closest(".drag-handle");
  if (!currentUser || !handle) {
    event.preventDefault();
    return;
  }
  draggedId = handle.closest(".song-card").dataset.id;
  handle.closest(".song-card").classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedId);
});

elements.grid.addEventListener("dragover", (event) => {
  const card = event.target.closest(".song-card");
  if (!card || card.dataset.id === draggedId) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
  card.classList.add("drag-over");
});

elements.grid.addEventListener("drop", (event) => {
  const card = event.target.closest(".song-card");
  event.preventDefault();
  if (card) reorderSongs(draggedId, card.dataset.id);
  draggedId = null;
  clearDragStyles();
});

elements.grid.addEventListener("dragend", () => {
  draggedId = null;
  clearDragStyles();
});

elements.grid.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".drag-handle");
  if (!currentUser || !handle || event.pointerType === "mouse") return;
  draggedId = handle.closest(".song-card").dataset.id;
  touchTargetId = null;
  handle.setPointerCapture(event.pointerId);
  handle.closest(".song-card").classList.add("dragging");
});

elements.grid.addEventListener("pointermove", (event) => {
  if (!draggedId || event.pointerType === "mouse") return;
  event.preventDefault();
  const card = document.elementFromPoint(event.clientX, event.clientY)?.closest(".song-card");
  document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
  if (card && card.dataset.id !== draggedId) {
    touchTargetId = card.dataset.id;
    card.classList.add("drag-over");
  }
});

function finishTouchDrag(event) {
  if (!draggedId || event.pointerType === "mouse") return;
  const fromId = draggedId;
  const toId = touchTargetId;
  draggedId = null;
  touchTargetId = null;
  clearDragStyles();
  if (event.type !== "pointercancel") reorderSongs(fromId, toId);
}

elements.grid.addEventListener("pointerup", finishTouchDrag);
elements.grid.addEventListener("pointercancel", finishTouchDrag);

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    localStore.set("bajaw-view", view);
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
    elements.grid.classList.toggle("list", view === "list");
  });
});

$("#random").addEventListener("click", () => {
  const availableSongs = visibleSongs().length ? visibleSongs() : songs;
  if (!availableSongs.length) {
    showToast("Add a song before using shuffle.");
    return;
  }
  const song = availableSongs[Math.floor(Math.random() * availableSongs.length)];
  window.open(song.chordUrl, "_blank", "noopener,noreferrer");
});

const initialTheme = localStore.get("bajaw-theme", null)
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.documentElement.dataset.theme = initialTheme;
$("#theme").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStore.set("bajaw-theme", theme);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === "Escape" && document.activeElement === elements.search) {
    elements.search.value = "";
    elements.search.blur();
    render();
  }
});

window.addEventListener("offline", () => setStatus("You are offline. Showing the last available playlist.", "offline"));
window.addEventListener("online", () => setStatus("Back online. Synchronizing changes…", "success"));
window.addEventListener("beforeunload", () => unsubscribeSongs?.());

document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
elements.grid.classList.toggle("list", view === "list");
renderAuth();
render();
initializeFirebase();
