
import {
  firebaseReady,
  waitForUser,
  getCloudFavorites,
  saveCloudFavorite,
  removeCloudFavorite
} from "./firebase.js";

// VERSÉLLE BOOKS
document.title = "Versélle Books | Digital Library";

const API = {
  books: "https://openlibrary.org/api/books.json",
  search: "https://openlibrary.org/search.json",
  subjects: "https://openlibrary.org/subjects"
};

const $ = (selector) => document.querySelector(selector);

const bookGrid = $("#bookGrid");
const statusMessage = $("#statusMessage");
const resultCount = $("#resultCount");
const resultsTitle = $("#resultsTitle");
const resultsEyebrow = $("#resultsEyebrow");
const loadMoreBtn = $("#loadMoreBtn");
const modal = $("#bookModal");
const modalContent = $("#modalContent");
const toast = $("#toast");

let currentQuery = "";
let currentSubject = "fiction";
let currentPage = 1;
let currentBooks = [];
let activeMode = "subject";
let favorites = loadLocalFavorites();
let firebaseUser = null;
let toastTimer;

function loadLocalFavorites() {
  try {
    return JSON.parse(
      localStorage.getItem("verselleBooksFavorites") || "[]"
    );
  } catch {
    return [];
  }
}

function saveLocalFavorites() {
  localStorage.setItem(
    "verselleBooksFavorites",
    JSON.stringify(favorites)
  );

  const count = $("#favoriteCount");
  if (count) count.textContent = favorites.length;
}

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2300);
}

function setLoading(message = "Discovering beautiful books...") {
  statusMessage.textContent = message;
  statusMessage.classList.remove("hidden", "error");
  bookGrid.innerHTML = "";
  loadMoreBtn.classList.add("hidden");
}

function setError(message) {
  statusMessage.textContent = message;
  statusMessage.classList.remove("hidden");
  statusMessage.classList.add("error");
  bookGrid.innerHTML = "";
  loadMoreBtn.classList.add("hidden");
}

function normalizeBook(book) {
  const key =
    book.key ||
    (book.edition_key?.[0]
      ? `/works/${book.edition_key[0]}`
      : "");

  return {
    key,
    title: book.title || "Untitled book",

    author: Array.isArray(book.author_name)
      ? book.author_name[0]
      : book.authors?.[0]?.name || "Unknown author",

    year:
      book.first_publish_year ||
      book.publish_date?.[0] ||
      "",

    coverId:
      book.cover_i ||
      book.cover_id ||
      book.covers?.[0] ||
      null,

    editionKey: book.edition_key?.[0] || null,
    isbn: book.isbn?.[0] || null,
    subjects: book.subject || [],

    openUrl: key
      ? `https://openlibrary.org${key}`
      : "https://openlibrary.org/"
  };
}

function coverUrl(book, size = "M") {
  if (book.coverId) {
    return `https://covers.openlibrary.org/b/id/${book.coverId}-${size}.jpg`;
  }

  if (book.isbn) {
    return `https://covers.openlibrary.org/b/isbn/${book.isbn}-${size}.jpg`;
  }

  return "";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function isFavorite(book) {
  return favorites.some((item) => item.key === book.key);
}

function renderBooks(books, append = false) {
  statusMessage.classList.add("hidden");

  if (!append) {
    bookGrid.innerHTML = "";
  }

  if (!books.length && !append) {
    statusMessage.textContent =
      "No books found. Please try another title or category.";

    statusMessage.classList.remove("hidden");
    return;
  }

  const html = books.map((book) => {
    const image = coverUrl(book);
    const saved = isFavorite(book);

    return `
      <article
        class="book-card"
        data-key="${escapeHtml(book.key)}"
        tabindex="0"
        aria-label="View ${escapeHtml(book.title)}"
      >
        <div class="cover-wrap">

          ${
            image
              ? `
                <img
                  src="${image}"
                  alt="Cover of ${escapeHtml(book.title)}"
                  loading="lazy"
                  onerror="
                    this.style.display='none';
                    this.nextElementSibling.classList.remove('hidden')
                  "
                >

                <div class="cover-placeholder hidden">
                  ${escapeHtml(book.title)}
                </div>
              `
              : `
                <div class="cover-placeholder">
                  ${escapeHtml(book.title)}
                </div>
              `
          }

          <button
            class="heart-btn ${saved ? "saved" : ""}"
            data-fav="${escapeHtml(book.key)}"
            type="button"
            aria-label="${saved ? "Remove favourite" : "Add favourite"}"
          >
            ${saved ? "♥" : "♡"}
          </button>

        </div>

        <div class="book-info">
          <h3 class="book-title">
            ${escapeHtml(book.title)}
          </h3>

          <p class="book-author">
            ${escapeHtml(book.author)}
          </p>

          ${
            book.year
              ? `<span class="book-year">${escapeHtml(book.year)}</span>`
              : ""
          }
        </div>
      </article>
    `;
  }).join("");

  bookGrid.insertAdjacentHTML(
    append ? "beforeend" : "afterbegin",
    html
  );

  resultCount.textContent = `${currentBooks.length} books`;

  loadMoreBtn.classList.toggle(
    "hidden",
    activeMode === "favorites" ||
    (activeMode === "search" && currentBooks.length >= 100)
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

// API 1: Open Library Books API
async function getBookDetails(book) {
  const identifier = book.editionKey
    ? `OLID:${book.editionKey}`
    : book.isbn
      ? `ISBN:${book.isbn}`
      : null;

  if (!identifier) return null;

  const params = new URLSearchParams({
    bibkeys: identifier,
    jscmd: "data",
    format: "json"
  });

  const data = await fetchJson(
    `${API.books}?${params.toString()}`
  );

  return data[identifier] || null;
}

// API 2: Open Library Search API
async function searchBooks(query, page = 1) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: "20",
    fields:
      "key,title,author_name,first_publish_year,cover_i,edition_key,isbn,subject"
  });

  return fetchJson(
    `${API.search}?${params.toString()}`
  );
}

// API 3: Open Library Subjects API
async function getSubjectBooks(subject, page = 1) {
  const params = new URLSearchParams({
    limit: "20",
    offset: String((page - 1) * 20)
  });

  return fetchJson(
    `${API.subjects}/${encodeURIComponent(subject)}.json?${params.toString()}`
  );
}

async function loadSubject(subject = "fiction", page = 1) {
  activeMode = "subject";
  currentSubject = subject;
  currentPage = page;

  resultsEyebrow.textContent = "EXPLORE YOUR INTEREST";
  resultsTitle.textContent =
    `${subject.replaceAll("_", " ")} reads`;

  if (page === 1) {
    setLoading("Discovering beautiful books...");
  } else {
    statusMessage.textContent = "Loading more books...";
    statusMessage.classList.remove("hidden", "error");
  }

  try {
    const data = await getSubjectBooks(subject, page);

    const docs = (data.works || []).map(normalizeBook);

    currentBooks =
      page === 1
        ? docs
        : [...currentBooks, ...docs];

    renderBooks(docs, page > 1);

    loadMoreBtn.classList.toggle(
      "hidden",
      !data.works || data.works.length < 20
    );

  } catch (error) {
    console.error("Subject API error:", error);

    setError(
      "Unable to load books. Please check your internet connection."
    );
  }
}

async function loadSearch(query, page = 1) {
  if (!query.trim()) return;

  activeMode = "search";
  currentQuery = query.trim();
  currentPage = page;

  resultsEyebrow.textContent = "SEARCH RESULTS";
  resultsTitle.textContent =
    `Results for "${currentQuery}"`;

  if (page === 1) {
    setLoading("Searching Versélle Books...");
  } else {
    statusMessage.textContent = "Loading more books...";
    statusMessage.classList.remove("hidden", "error");
  }

  try {
    const data = await searchBooks(currentQuery, page);

    const docs = (data.docs || []).map(normalizeBook);

    currentBooks =
      page === 1
        ? docs
        : [...currentBooks, ...docs];

    renderBooks(docs, page > 1);

    resultCount.textContent =
      `${data.numFound?.toLocaleString() || docs.length} results`;

    loadMoreBtn.classList.toggle(
      "hidden",
      docs.length < 20 || currentBooks.length >= 100
    );

  } catch (error) {
    console.error("Search API error:", error);

    setError(
      "Search is temporarily unavailable. Please try again."
    );
  }
}

function loadFavorites() {
  activeMode = "favorites";

  resultsEyebrow.textContent = "YOUR PERSONAL SHELF";
  resultsTitle.textContent = "My Favourite Books";

  currentBooks = [...favorites];

  resultCount.textContent = `${favorites.length} saved`;

  loadMoreBtn.classList.add("hidden");

  if (!favorites.length) {
    bookGrid.innerHTML = "";

    statusMessage.textContent =
      "Your favourite shelf is empty. Tap the heart on a book to save it.";

    statusMessage.classList.remove("hidden");
    return;
  }

  renderBooks(currentBooks);
}

function safeDocId(key) {
  return String(key || "book")
    .replaceAll("/", "_")
    .replaceAll(".", "_");
}

async function toggleFavorite(bookKey) {
  const book =
    currentBooks.find((item) => item.key === bookKey) ||
    favorites.find((item) => item.key === bookKey);

  if (!book) return;

  if (isFavorite(book)) {
    favorites = favorites.filter(
      (item) => item.key !== bookKey
    );

    saveLocalFavorites();

    if (firebaseUser) {
      try {
        await removeCloudFavorite(
          firebaseUser,
          safeDocId(bookKey)
        );
      } catch (error) {
        console.warn("Cloud remove failed:", error);
      }
    }

    showToast("Removed from your favourites.");

  } else {
    favorites.push(book);

    saveLocalFavorites();

    if (firebaseUser) {
      try {
        // Keep the original book key in Firestore data.
        await saveCloudFavorite(firebaseUser, book);
      } catch (error) {
        console.warn("Cloud save failed:", error);
      }
    }

    showToast("Added to your favourites ♡");
  }

  if (activeMode === "favorites") {
    loadFavorites();
  } else {
    renderBooks(currentBooks);
  }
}

async function openBook(bookKey) {
  const book =
    currentBooks.find((item) => item.key === bookKey) ||
    favorites.find((item) => item.key === bookKey);

  if (!book) return;

  const image = coverUrl(book, "L");

  modalContent.innerHTML = `
    <div class="modal-book-layout">

      <div>
        ${
          image
            ? `<img class="modal-cover" src="${image}" alt="Book cover">`
            : `<div class="cover-placeholder modal-cover">${escapeHtml(book.title)}</div>`
        }
      </div>

      <div>
        <span class="eyebrow">BOOK DETAILS</span>

        <h2 class="modal-title" id="modalTitle">
          ${escapeHtml(book.title)}
        </h2>

        <p class="modal-meta">
          By ${escapeHtml(book.author)}
          ${book.year ? ` • ${escapeHtml(book.year)}` : ""}
        </p>

        <p class="modal-description" id="modalDescription">
          Loading book information...
        </p>

        <div class="modal-actions">
          <a
            class="modal-read"
            href="${escapeHtml(book.openUrl)}"
            target="_blank"
            rel="noopener"
          >
            View on Open Library ↗
          </a>

          <button
            class="modal-fav"
            id="modalFavorite"
            type="button"
          >
            ${isFavorite(book) ? "♥ Saved" : "♡ Add favourite"}
          </button>
        </div>
      </div>

    </div>
  `;

  modal.classList.remove("hidden");

  $("#modalFavorite").addEventListener("click", async () => {
    await toggleFavorite(book.key);

    $("#modalFavorite").textContent =
      isFavorite(book) ? "♥ Saved" : "♡ Add favourite";
  });

  try {
    const detail = await getBookDetails(book);

    const description =
      detail?.excerpts?.[0]?.text ||
      detail?.description?.value ||
      detail?.description ||
      (
        detail?.subjects?.length
          ? `Subjects: ${detail.subjects.slice(0, 6).map((s) => s.name).join(", ")}`
          : ""
      );

    $("#modalDescription").textContent =
      description ||
      "No extra description is available. Visit Open Library to explore more details.";

  } catch (error) {
    console.warn("Book details unavailable:", error);

    $("#modalDescription").textContent =
      "Extra details could not be loaded right now.";
  }
}

async function setupFirebase() {
  if (!firebaseReady) {
    console.info("Firebase is not configured. Local favourites are active.");
    return;
  }

  try {
    firebaseUser = await waitForUser();

    if (!firebaseUser) return;

    const cloudFavorites =
      await getCloudFavorites(firebaseUser);

    if (cloudFavorites.length) {
      const merged = new Map(
        favorites.map((book) => [book.key, book])
      );

      cloudFavorites.forEach((book) => {
        merged.set(book.key, book);
      });

      favorites = [...merged.values()];

      saveLocalFavorites();

      if (activeMode === "favorites") {
        loadFavorites();
      }
    }

    console.info("Firebase connected successfully.");

  } catch (error) {
    console.warn("Firebase sync unavailable:", error);
  }
}

// SEARCH EVENT
$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();

  loadSearch($("#searchInput").value);
});

// CATEGORY EVENT
$("#categoryPills").addEventListener("click", (event) => {
  const button = event.target.closest("[data-subject]");

  if (!button) return;

  document.querySelectorAll(".category-pill")
    .forEach((pill) => pill.classList.remove("selected"));

  button.classList.add("selected");

  loadSubject(button.dataset.subject);
});

// NAVIGATION
$("#allBooksBtn").addEventListener("click", () => {
  loadSearch("popular books");
});

$("#favoritesNav").addEventListener("click", loadFavorites);

// LOAD MORE
loadMoreBtn.addEventListener("click", () => {
  if (activeMode === "subject") {
    loadSubject(currentSubject, currentPage + 1);
  }

  if (activeMode === "search") {
    loadSearch(currentQuery, currentPage + 1);
  }
});

// BOOK GRID
bookGrid.addEventListener("click", (event) => {
  const heart = event.target.closest("[data-fav]");

  if (heart) {
    event.stopPropagation();
    toggleFavorite(heart.dataset.fav);
    return;
  }

  const card = event.target.closest(".book-card");

  if (card) {
    openBook(card.dataset.key);
  }
});

// KEYBOARD ACCESSIBILITY
bookGrid.addEventListener("keydown", (event) => {
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.classList.contains("book-card")
  ) {
    event.preventDefault();
    openBook(event.target.dataset.key);
  }
});

// MODAL
$("#modalClose").addEventListener("click", () => {
  modal.classList.add("hidden");
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    modal.classList.add("hidden");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    modal.classList.add("hidden");
  }
});

// INITIALIZE WEBSITE
saveLocalFavorites();
loadSubject("fiction");
setupFirebase();
