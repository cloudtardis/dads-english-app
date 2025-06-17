// Simple spaced-repetition using SM-2 algorithm

const STORAGE_KEY = 'flashcards-v1';

/**
 * Load all stored cards from localStorage.
 * @returns {Flashcard[]} Array of cards
 */
function loadCards() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (err) {
        console.error('Error loading cards', err);
        return [];
    }
}

/**
 * Persist cards array to localStorage
 * @param {Flashcard[]} cards
 */
function saveCards(cards) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

/**
 * @typedef Flashcard
 * @property {string} id - unique id
 * @property {string} question
 * @property {string} answer
 * @property {string|null} audioData - DataURL for audio or null
 * @property {number} interval - days between reviews
 * @property {number} repetitions - how many times reviewed successfully
 * @property {number} easeFactor - difficulty factor (EF)
 * @property {number} nextReview - timestamp (ms) when due
 */

// DOM references
const addSection = document.getElementById('add-section');
const studySection = document.getElementById('study-section');

const navAdd = document.getElementById('nav-add');
const navStudy = document.getElementById('nav-study');
const navExport = document.getElementById('nav-export');
const navImport = document.getElementById('nav-import');
const importFileInput = document.getElementById('import-file');

const questionInput = document.getElementById('question');
const answerInput = document.getElementById('answer');
const audioInput = document.getElementById('audio');

const form = document.getElementById('card-form');

const dueCountEl = document.getElementById('due-count');
const cardBox = document.getElementById('card-box');
const cardQuestionEl = document.getElementById('card-question');
const cardAnswerEl = document.getElementById('card-answer');
const revealArea = document.getElementById('reveal-area');
const cardAudio = document.getElementById('card-audio');
const noDueEl = document.getElementById('no-due');

const ratingButtons = document.querySelectorAll('.rating-buttons button');

let cards = loadCards();
let currentCard = null; // card object currently displayed

// ---- Navigation ----
navAdd.addEventListener('click', () => {
    addSection.classList.remove('hidden');
    studySection.classList.add('hidden');
});

navStudy.addEventListener('click', () => {
    startStudy();
    addSection.classList.add('hidden');
    studySection.classList.remove('hidden');
});

navExport.addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(cards, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', 'flashcards.json');
    dl.click();
});

navImport.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const imported = JSON.parse(ev.target.result);
            if (Array.isArray(imported)) {
                cards = imported;
                saveCards(cards);
                alert('Import successful!');
            } else {
                alert('Invalid file');
            }
        } catch (err) {
            alert('Error parsing file');
        }
    };
    reader.readAsText(file);
    // reset
    importFileInput.value = '';
});

// ---- Add card ----

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = questionInput.value.trim();
    const answer = answerInput.value.trim();
    if (!question || !answer) return;

    const file = audioInput.files[0];

    // handle async read if file exists
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            createCard(question, answer, ev.target.result);
        };
        reader.readAsDataURL(file);
    } else {
        createCard(question, answer, null);
    }
});

function createCard(question, answer, audioData) {
    const card = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        question,
        answer,
        audioData, // base64 or null
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        nextReview: Date.now()
    };
    cards.push(card);
    saveCards(cards);

    // reset form
    questionInput.value = '';
    answerInput.value = '';
    audioInput.value = '';

    alert('Card saved!');
}

// ---- Study flow ----

function startStudy() {
    updateDueCount();
    showNextCard();
}

function updateDueCount() {
    const dueCards = cards.filter((c) => c.nextReview <= Date.now());
    dueCountEl.textContent = `Cards due: ${dueCards.length}`;
}

function showNextCard() {
    revealArea.classList.add('hidden');
    noDueEl.classList.add('hidden');
    cardBox.classList.add('hidden');

    const dueCards = cards.filter((c) => c.nextReview <= Date.now());
    if (dueCards.length === 0) {
        noDueEl.classList.remove('hidden');
        return;
    }

    currentCard = dueCards.sort((a, b) => a.nextReview - b.nextReview)[0];
    cardQuestionEl.textContent = currentCard.question;
    cardAnswerEl.textContent = currentCard.answer;
    if (currentCard.audioData) {
        cardAudio.src = currentCard.audioData;
        cardAudio.load();
    } else {
        cardAudio.removeAttribute('src');
        cardAudio.load();
    }
    cardBox.classList.remove('hidden');
}

// Reveal answer on click on question area
cardQuestionEl.addEventListener('click', () => {
    revealArea.classList.remove('hidden');
    if (currentCard && currentCard.audioData) {
        cardAudio.play();
    }
});

// rating buttons
ratingButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        const rating = Number(btn.dataset.rating);
        if (currentCard) {
            processRating(currentCard, rating);
            saveCards(cards);
            updateDueCount();
            showNextCard();
        }
    });
});

// SM-2 algorithm implementation
function processRating(card, quality) {
    // Quality 0-5
    if (quality < 3) {
        card.repetitions = 0;
        card.interval = 1;
    } else {
        if (card.repetitions === 0) {
            card.interval = 1;
        } else if (card.repetitions === 1) {
            card.interval = 6;
        } else {
            card.interval = Math.round(card.interval * card.easeFactor);
        }
        card.repetitions += 1;

        // Update Ease Factor
        card.easeFactor = Math.max(1.3, card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    }
    // set next review date
    const millisInDay = 24 * 60 * 60 * 1000;
    card.nextReview = Date.now() + card.interval * millisInDay;
}

// Initialize default view
startStudy();
