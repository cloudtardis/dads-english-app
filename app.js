// Simple spaced-repetition using SM-2 algorithm


// --- Persistence (IndexedDB) -------------------------------------------------

// All card data is now stored inside the browser's IndexedDB instead of
// LocalStorage so we can scale beyond the 5 MB quota and avoid synchronous
// blocking calls.

const DB_NAME = 'flashcards-db';
const DB_VERSION = 1;
const STORE_NAME = 'cards';

/**
 * Open (or create) the app database. On first run it provisions an object
 * store using `id` as the primary key.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    if (!('indexedDB' in window)) {
        return Promise.reject(new Error('IndexedDB is not supported in this environment'));
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Load all stored cards from IndexedDB.
 *
 * @returns {Promise<Flashcard[]>} Array of cards (may be empty)
 */
async function loadCards() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error('Error loading cards from IndexedDB', err);
        return [];
    }
}

/**
 * Persist the provided set of cards to IndexedDB. The strategy is simple but
 * robust: clear the store and then put all current cards. For the modest data
 * sizes of a flash-card deck this is fast and keeps the logic trivial.
 *
 * Any failure is logged and surfaced to the user once per session.
 *
 * @param {Flashcard[]} cards
 */
async function saveCards(cards) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);

            // Clear previous state so removed cards disappear.
            store.clear();

            for (const card of cards) {
                store.put(card);
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (err) {
        console.error('Failed to write to IndexedDB', err);

        if (!saveCards._warned) {
            alert('⚠️  Failed to save cards to your browser storage. Changes will only last until you refresh this tab.');
            saveCards._warned = true;
        }
    }
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
const audioInput = document.getElementById('audio'); // may be null if upload option removed
const generateAudioBtn = document.getElementById('generate-audio-btn');
const generateStatus = document.getElementById('generate-status');

// New elements for advanced AI flow
const promptInput = document.getElementById('prompt');
const genSentenceBtn = document.getElementById('generate-sentence-btn');
const genSentenceStatus = document.getElementById('gen-sentence-status');
const genVoiceBtn = document.getElementById('generate-voice-trans-btn');
const genVoiceStatus = document.getElementById('gen-voice-status');

// Button & status for paragraph voice generation
const genParagraphVoiceBtn = document.getElementById('generate-paragraph-voice-btn');
const genParagraphVoiceStatus = document.getElementById('gen-paragraph-voice-status');
// Button & status for paragraph translation
const genParagraphTranslationBtn = document.getElementById('generate-paragraph-translation-btn');
const genParagraphTranslationStatus = document.getElementById('gen-paragraph-translation-status');

let generatedAudioData = null; // dataURL produced by AI TTS if any

// Utility: fetch with a timeout to avoid indefinite waiting
async function fetchWithTimeout(url, options = {}, timeout = 20000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
        clearTimeout(id);
    }
}

// ---- AI Text-to-Speech generation ----
if (generateAudioBtn) {
    generateAudioBtn.addEventListener('click', async () => {
        const text = questionInput.value.trim();
        if (!text) {
            alert('Please type a question/sentence first.');
            return;
        }

        // Ask for API key (stored in LocalStorage for convenience)
        let apiKey = localStorage.getItem('openai_api_key');
        if (!apiKey) {
            apiKey = prompt('Enter your OpenAI API key (it will be stored locally):');
            if (!apiKey) return;
            localStorage.setItem('openai_api_key', apiKey);
        }

        try {
            generateStatus.classList.remove('hidden');
            generateStatus.textContent = 'Generating…';
            generateAudioBtn.disabled = true;

            const dataUrl = await generateTTS(text, apiKey);
            generatedAudioData = dataUrl;

            // Clear any file selection to avoid confusion
            if (audioInput) audioInput.value = '';

            generateStatus.textContent = 'Voice ready! (will be attached)';
        } catch (err) {
            console.error(err);
            alert('Failed to generate audio.');
            generateStatus.textContent = 'Error';
        } finally {
            generateAudioBtn.disabled = false;
            setTimeout(() => generateStatus.classList.add('hidden'), 4000);
        }
    });
}

// ---- Generate paragraph voice (Australian female, slow) ----
if (genParagraphVoiceBtn) {
    genParagraphVoiceBtn.addEventListener('click', async () => {
        const paragraph = questionInput.value.trim();
        if (!paragraph) {
            alert('Please type an English paragraph first.');
            return;
        }

        let apiKey = getApiKey();
        if (!apiKey) return;

        try {
            genParagraphVoiceStatus.classList.remove('hidden');
            genParagraphVoiceStatus.textContent = 'Generating voice…';
            genParagraphVoiceBtn.disabled = true;

            const dataUrl = await generateTTS(paragraph, apiKey);
            generatedAudioData = dataUrl;
            if (audioInput) audioInput.value = '';
            genParagraphVoiceStatus.textContent = 'Voice ready! (will be attached)';
        } catch (err) {
            console.error(err);
            alert('Failed to generate voice. Please check your API key/quota.');
            genParagraphVoiceStatus.textContent = 'Error';
        } finally {
            genParagraphVoiceBtn.disabled = false;
            setTimeout(() => genParagraphVoiceStatus.classList.add('hidden'), 4000);
        }
    });
}

// ---- Generate paragraph translation (Traditional Chinese) ----
if (genParagraphTranslationBtn) {
    genParagraphTranslationBtn.addEventListener('click', async () => {
        const paragraph = questionInput.value.trim();
        if (!paragraph) {
            alert('Please type an English paragraph first.');
            return;
        }

        let apiKey = getApiKey();
        if (!apiKey) return;

        try {
            genParagraphTranslationStatus.classList.remove('hidden');
            genParagraphTranslationStatus.textContent = 'Generating translation…';
            genParagraphTranslationBtn.disabled = true;

            const chinese = await translateToTraditionalChinese(paragraph, apiKey);
            answerInput.value = chinese;

            genParagraphTranslationStatus.textContent = 'Translation ready!';
        } catch (err) {
            console.error(err);
            alert('Failed to generate translation.');
            genParagraphTranslationStatus.textContent = 'Error';
        } finally {
            genParagraphTranslationBtn.disabled = false;
            setTimeout(() => genParagraphTranslationStatus.classList.add('hidden'), 4000);
        }
    });
}

// ---- Generate English sentence from prompt ----
if (genSentenceBtn) {
    genSentenceBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        if (!prompt) {
            alert('Please type a prompt/topic first.');
            return;
        }

        let apiKey = getApiKey();
        if (!apiKey) return;

        try {
            genSentenceStatus.classList.remove('hidden');
            genSentenceStatus.textContent = 'Generating…';
            genSentenceBtn.disabled = true;

            const sentence = await generateSentence(prompt, apiKey);
            questionInput.value = sentence;

            // First, get the Chinese translation
            const chinese = await translateToTraditionalChinese(sentence, apiKey);
            answerInput.value = chinese;

            // Next, attempt to produce TTS voice (non-critical)
            let audioUrl = null;
            try {
                audioUrl = await generateTTS(sentence, apiKey);
                generatedAudioData = audioUrl;
            } catch (ttsErr) {
                console.warn('TTS generation failed', ttsErr);
            }

            genSentenceStatus.textContent = audioUrl ? 'Sentence & audio ready. Click Save.' : 'Sentence ready. Click Save.';
        } catch (err) {
            console.error(err);
            genSentenceStatus.textContent = 'Error generating. Check API key / quota.';
        } finally {
            genSentenceBtn.disabled = false;
            setTimeout(() => genSentenceStatus.classList.add('hidden'), 4000);
        }
    });
}

// ---- Generate voice + Chinese translation ----
if (genVoiceBtn) {
    genVoiceBtn.addEventListener('click', async () => {
        const sentence = questionInput.value.trim();
        if (!sentence) {
            alert('Please ensure the English sentence is filled.');
            return;
        }

        let apiKey = getApiKey();
        if (!apiKey) return;

        try {
            genVoiceStatus.classList.remove('hidden');
            genVoiceStatus.textContent = 'Generating…';
            genVoiceBtn.disabled = true;

            // Parallel generation
            const [audioUrl, chinese] = await Promise.all([
                generateTTS(sentence, apiKey),
                translateToTraditionalChinese(sentence, apiKey)
            ]);

            generatedAudioData = audioUrl;
            if (audioInput) audioInput.value = '';
            answerInput.value = chinese;

            genVoiceStatus.textContent = 'Voice & translation ready!';
        } catch (err) {
            console.error(err);
            alert('Failed to generate voice/translation.');
            genVoiceStatus.textContent = 'Error';
        } finally {
            genVoiceBtn.disabled = false;
            setTimeout(() => genVoiceStatus.classList.add('hidden'), 4000);
        }
    });
}

function getApiKey() {
    let key = localStorage.getItem('openai_api_key');
    if (!key) {
        key = prompt('Enter your OpenAI API key (it will be stored locally):');
        if (key) localStorage.setItem('openai_api_key', key);
    }
    return key;
}

async function generateSentence(prompt, apiKey) {
    const payload = {
        model: 'gpt-3.5-turbo',
        messages: [
            { role: 'system', content: 'You are an assistant who creates longer English paragraphs (6-10 sentences) suitable for ESL learners.' },
            { role: 'user', content: `Create one longer English paragraph (6-10 sentences) based on: "${prompt}". Do NOT include translations. Do NOT wrap in quotes.` }
        ],
        max_tokens: 300,
        temperature: 0.7
    };

    const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error('OpenAI completion failed: ' + errText);
    }

    const data = await resp.json();
    const sentence = data.choices[0].message.content.trim();
    return sentence;
}

async function translateToTraditionalChinese(text, apiKey) {
    // Break very long input into approximate 3500-char chunks so each request
    // comfortably fits within token limits and avoids truncation. The
    // resulting Chinese segments are then re-joined with blank lines,
    // preserving paragraph structure.

    const CHUNK_SIZE = 3500;
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        chunks.push(text.slice(i, i + CHUNK_SIZE));
    }

    const translations = [];
    for (const chunk of chunks) {
        translations.push(await translateChunk(chunk, apiKey));
    }

    return translations.join('\n\n');
}

async function translateChunk(englishText, apiKey) {
    // Provide a generous max_tokens based on input length (chars * 1.5 ≈ tokens).
    const maxTokens = Math.min(4096, Math.ceil(englishText.length * 1.5));

    const payload = {
        model: 'gpt-3.5-turbo-16k',
        messages: [
            { role: 'system', content: 'You are a strict translator. Return ONLY the full Traditional Chinese translation of the user provided text. Preserve paragraph breaks. Do NOT omit or summarise.' },
            { role: 'user', content: `請完整翻譯下列內容為繁體中文（僅中文、請保留段落換行）：\n\n${englishText}` }
        ],
        temperature: 0.2,
        max_tokens: maxTokens
    };

    const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    }, 60000);

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error('OpenAI completion failed: ' + errText);
    }

    const data = await resp.json();
    return data.choices[0].message.content.trim();
}

async function generateTTS(text, apiKey) {
    const payload = {
        // Higher-fidelity model
        model: 'tts-1-hd',
        input: text,
        // Upbeat female voice
        voice: 'shimmer',
        // Slightly higher pitch for extra brightness
        voice_preset: {
            pitch: 4  // +4 semitones for a younger, lighter tone
        },
        format: 'mp3'
    };

    const resp = await fetchWithTimeout('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error('OpenAI TTS failed: ' + errText);
    }

    const arrayBuffer = await resp.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    return `data:audio/mp3;base64,${base64}`;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

const form = document.getElementById('card-form');

const dueCountEl = document.getElementById('due-count');
const skipDayBtn = document.getElementById('skip-day-btn');
const cardBox = document.getElementById('card-box');
const cardQuestionEl = document.getElementById('card-question');
const cardAnswerEl = document.getElementById('card-answer');
const revealArea = document.getElementById('reveal-area');
const cardAudio = document.getElementById('card-audio');
const audioToggleBtn = document.getElementById('audio-toggle-btn');
const rewindBtn = document.getElementById('rewind-5-btn');
const showAnswerBtn = document.getElementById('show-answer');
const cardList = document.getElementById('card-list');
const saveCardBtn = document.getElementById('save-card-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const noDueEl = document.getElementById('no-due');
const saveStatusEl = document.getElementById('save-status');

function autoSaveCard(question, answer, audioData) {
    if (editingCardId) {
        updateExistingCard(editingCardId, question, answer, audioData);
    } else {
        createCard(question, answer, audioData);
    }
    showSavedStatus('Card saved!');
}

// utility to stop any ongoing audio and looping timer
function stopAudio() {
    clearTimeout(audioLoopTimeout);
    audioLoopTimeout = null;
    if (cardAudio) {
        cardAudio.pause();
        cardAudio.onended = null;
        cardAudio.currentTime = 0;
    }
    if (audioToggleBtn) {
        audioToggleBtn.textContent = '▶️';
    }


}

// helper to set up looping playback with 5s pause between repeats
function setupAudioLooping() {
    if (!cardAudio) return;
    cardAudio.onended = () => {
        audioLoopTimeout = setTimeout(() => {
            cardAudio.currentTime = 0;
            cardAudio.play().catch(() => {/* autoplay may be blocked */});
        }, 5000); // 5 second pause before replay
    };
}

const ratingButtons = document.querySelectorAll('.rating-buttons button');

let audioLoopTimeout = null;

let editingCardId = null; // if not null, we're editing existing card

function showSavedStatus(msg) {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = msg;
    saveStatusEl.classList.remove('hidden');
    clearTimeout(showSavedStatus._timer);
    showSavedStatus._timer = setTimeout(() => saveStatusEl.classList.add('hidden'), 3000);
}

// ---- Card list rendering and CRUD ----
function renderCardList() {
    if (!cardList) return;
    cardList.innerHTML = '';
    if (cards.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No cards yet.';
        cardList.appendChild(li);
        return;
    }

    // sort cards by days until next review (ascending)
    const sortedCards = [...cards].sort((a, b) => a.nextReview - b.nextReview);

    sortedCards.forEach((card) => {
        const li = document.createElement('li');

        const textSpan = document.createElement('span');
        textSpan.textContent = card.question.length > 60 ? card.question.slice(0, 60) + '…' : card.question;
        li.appendChild(textSpan);

        const btnContainer = document.createElement('span');

        // days until due
        const millisInDay = 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(0, Math.ceil((card.nextReview - Date.now()) / millisInDay));
        const daysEl = document.createElement('span');
        daysEl.textContent = `${daysLeft}d`;
        daysEl.classList.add('days-left');
        btnContainer.appendChild(daysEl);

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.classList.add('edit-btn');
        editBtn.addEventListener('click', () => beginEdit(card.id));
        // play audio button
        if (card.audioData) {
            const playBtn = document.createElement('button');
            playBtn.textContent = 'Play';
            playBtn.classList.add('play-btn');
            playBtn.addEventListener('click', () => {
                const audio = new Audio(card.audioData);
                audio.play();
            });
            btnContainer.appendChild(playBtn);
        }


        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.classList.add('delete-btn');
        delBtn.addEventListener('click', () => deleteCard(card.id));

        btnContainer.appendChild(editBtn);
        btnContainer.appendChild(delBtn);
        li.appendChild(btnContainer);

        cardList.appendChild(li);
    });
}

function beginEdit(id) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    editingCardId = id;
    questionInput.value = card.question;
    answerInput.value = card.answer;
    if (audioInput) audioInput.value = '';

    saveCardBtn.textContent = 'Update Card';
    cancelEditBtn.classList.remove('hidden');

    // Switch to Add section
    addSection.classList.remove('hidden');
    studySection.classList.add('hidden');
}

function deleteCard(id) {
    // Straight-forward deletion without confirmation dialog
    cards = cards.filter((c) => c.id !== id);
    saveCards(cards);
    renderCardList();
    updateDueCount();
}

if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
        editingCardId = null;
        questionInput.value = '';
        answerInput.value = '';
        if (audioInput) audioInput.value = '';
        saveCardBtn.textContent = 'Save Card';
        cancelEditBtn.classList.add('hidden');
    });
}

// All card data will reside here after asynchronous initialisation.
let cards = [];

// Card currently displayed during study mode
let currentCard = null;

// Kick-off once everything is parsed. By placing this at the end of the file
// we make sure all functions & event-listeners are already defined.
(async function init() {
    cards = await loadCards();

    renderCardList();

    // Default landing view: Study section
    startStudy();
    addSection.classList.add('hidden');
    studySection.classList.remove('hidden');
})();

// ---- Navigation ----
navAdd.addEventListener('click', () => {
    stopAudio();
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

// ---- Skip Day ----
if (skipDayBtn) {
    skipDayBtn.addEventListener('click', () => {
        skipOneDay();
    });
}

function skipOneDay() {
    const millisInDay = 24 * 60 * 60 * 1000;
    cards.forEach((card) => {
        card.nextReview -= millisInDay;
    });
    saveCards(cards);
    updateDueCount();
    showNextCard();
}

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
                renderCardList();
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

if (saveCardBtn) {
    saveCardBtn.addEventListener('click', async () => {
    const question = questionInput.value.trim();
    const answer = answerInput.value.trim();
    if (!question || !answer) return;

    const handleData = (audioData) => {
        if (editingCardId) {
            updateExistingCard(editingCardId, question, answer, audioData);
        } else {
            createCard(question, answer, audioData);
        }
    };

    const file = audioInput ? audioInput.files[0] : null;
    let audioData = null;

    if (file) {
        try {
            audioData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target.result);
                reader.onerror = (err) => reject(err);
                reader.readAsDataURL(file);
            });
        } catch (err) {
            console.error('Error reading attached audio file', err);
            alert('Failed to read attached audio file.');
            return;
        }
    } else if (generatedAudioData) {
        audioData = generatedAudioData;
        generatedAudioData = null;
    } else if (editingCardId) {
        const existing = cards.find(c => c.id === editingCardId);
        audioData = existing ? existing.audioData : null;
    }

    handleData(audioData);
});
}

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
    if (promptInput) promptInput.value = '';
    questionInput.value = '';
    answerInput.value = '';
    if (audioInput) audioInput.value = '';

    showSavedStatus('Card saved!');

    renderCardList();
}

function updateExistingCard(id, question, answer, audioData) {
    const card = cards.find(c => c.id === id);
    if (!card) return;

    card.question = question;
    card.answer = answer;
    if (audioData !== undefined) card.audioData = audioData;

    saveCards(cards);

    editingCardId = null;
    saveCardBtn.textContent = 'Save Card';
    cancelEditBtn.classList.add('hidden');

    // reset form inputs
    questionInput.value = '';
    answerInput.value = '';
    if (audioInput) audioInput.value = '';

    showSavedStatus('Card updated!');

    renderCardList();
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
    showAnswerBtn.classList.remove('hidden');

    // stop any previous looping audio
    stopAudio();

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

        setupAudioLooping();
        cardAudio.play().catch(() => {/* autoplay might be blocked */});
        if (audioToggleBtn) {
            audioToggleBtn.classList.remove('hidden');
            audioToggleBtn.textContent = '▶️';
        }
        if (rewindBtn) {
            rewindBtn.classList.remove('hidden');
        }
    } else {
        cardAudio.removeAttribute('src');
        cardAudio.load();
        if (audioToggleBtn) {
            audioToggleBtn.classList.add('hidden');
        }
        if (rewindBtn) {
            rewindBtn.classList.add('hidden');
        }
    }

    cardBox.classList.remove('hidden');
}

function revealAnswer() {
    revealArea.classList.remove('hidden');
    showAnswerBtn.classList.add('hidden');
}

// Reveal answer via question click or explicit button
cardQuestionEl.addEventListener('click', revealAnswer);
showAnswerBtn.addEventListener('click', revealAnswer);
// Toggle play/stop for audio
if (audioToggleBtn) {
    audioToggleBtn.addEventListener('click', () => {
        if (cardAudio.paused) {
            // Resume playback from current position
            setupAudioLooping();
            cardAudio.play().catch(() => {});
        } else {
            // Just pause – don't reset to the beginning
            clearTimeout(audioLoopTimeout);
            audioLoopTimeout = null;
            cardAudio.pause();
        }
    });
    cardAudio.addEventListener('play', () => {
        audioToggleBtn.textContent = '⏸️';
    });
    cardAudio.addEventListener('pause', () => {
        audioToggleBtn.textContent = '▶️';
    });
}

// Rewind 5 seconds button
if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
        if (!cardAudio.duration) return;
        cardAudio.currentTime = Math.max(0, cardAudio.currentTime - 5);
    });
}

// rating buttons
ratingButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        const value = btn.dataset.rating;
        if (!currentCard) return;
        const isEasy = value === 'easy';
        processRatingBinary(currentCard, isEasy);
        saveCards(cards);
        updateDueCount();
        showNextCard();
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

// Simplified 2-option algorithm (easy / hard)
function processRatingBinary(card, isEasy) {
    const millisInDay = 24 * 60 * 60 * 1000;

    if (!isEasy) {
        // Hard: reset learning cycle.
        card.repetitions = 0;
        card.interval = 1;
        card.easeFactor = Math.max(1.3, card.easeFactor - 0.15);
    } else {
        // Easy: grow interval.
        if (card.repetitions === 0) {
            card.interval = 1;
        } else if (card.repetitions === 1) {
            card.interval = 3;
        } else {
            card.interval = Math.round(card.interval * card.easeFactor);
        }
        card.repetitions += 1;
        card.easeFactor = Math.min(card.easeFactor + 0.05, 2.5);
    }

    card.nextReview = Date.now() + card.interval * millisInDay;
}

// Initialize default view
// NOTE: Study mode begins when the user clicks the “Study” nav button.
