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
const generateAudioBtn = document.getElementById('generate-audio-btn');
const generateStatus = document.getElementById('generate-status');

// New elements for advanced AI flow
const promptInput = document.getElementById('prompt');
const genSentenceBtn = document.getElementById('generate-sentence-btn');
const genSentenceStatus = document.getElementById('gen-sentence-status');
const genVoiceBtn = document.getElementById('generate-voice-trans-btn');
const genVoiceStatus = document.getElementById('gen-voice-status');

let generatedAudioData = null; // dataURL produced by AI TTS if any

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
            audioInput.value = '';

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
            generatedAudioData = null; // reset any previously generated audio

            genSentenceStatus.textContent = 'Done! You can edit if needed.';
        } catch (err) {
            console.error(err);
            alert('Failed to generate sentence.');
            genSentenceStatus.textContent = 'Error';
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
            audioInput.value = '';
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
            { role: 'system', content: 'You are an assistant who creates single medium-length English sentences suitable for ESL learners.' },
            { role: 'user', content: `Create one medium-length English sentence (15-20 words) based on: "${prompt}". Do NOT include translations. Do NOT wrap in quotes.` }
        ],
        max_tokens: 60,
        temperature: 0.7
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
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
    const payload = {
        model: 'gpt-3.5-turbo',
        messages: [
            { role: 'system', content: 'You translate English to Traditional Chinese.' },
            { role: 'user', content: `Translate the following sentence into Traditional Chinese only (no pinyin): \n"${text}"` }
        ],
        max_tokens: 90,
        temperature: 0.3
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
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
    return data.choices[0].message.content.trim();
}

async function generateTTS(text, apiKey) {
    const payload = {
        model: 'tts-1',
        input: text,
        voice: 'alloy',
        format: 'mp3'
    };

    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
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
const showAnswerBtn = document.getElementById('show-answer');
const cardList = document.getElementById('card-list');
const saveCardBtn = document.getElementById('save-card-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const noDueEl = document.getElementById('no-due');

const ratingButtons = document.querySelectorAll('.rating-buttons button');

let audioLoopTimeout = null;

let editingCardId = null; // if not null, we're editing existing card

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

    cards.forEach((card) => {
        const li = document.createElement('li');

        const textSpan = document.createElement('span');
        textSpan.textContent = card.question.length > 60 ? card.question.slice(0, 60) + '…' : card.question;
        li.appendChild(textSpan);

        const btnContainer = document.createElement('span');

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.classList.add('edit-btn');
        editBtn.addEventListener('click', () => beginEdit(card.id));

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
    audioInput.value = '';

    saveCardBtn.textContent = 'Update Card';
    cancelEditBtn.classList.remove('hidden');

    // Switch to Add section
    addSection.classList.remove('hidden');
    studySection.classList.add('hidden');
}

function deleteCard(id) {
    if (!confirm('Delete this card?')) return;
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
        audioInput.value = '';
        saveCardBtn.textContent = 'Save Card';
        cancelEditBtn.classList.add('hidden');
    });
}

let cards = loadCards();

renderCardList();
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

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = questionInput.value.trim();
    const answer = answerInput.value.trim();
    if (!question || !answer) return;

    // Helper that actually saves/updates the card
    const handleData = (audioData) => {
        if (editingCardId) {
            updateExistingCard(editingCardId, question, answer, audioData);
        } else {
            createCard(question, answer, audioData);
        }
    };

    const file = audioInput.files[0];

    // If AI generated voice exists, use it regardless of file selection
    if (generatedAudioData) {
        handleData(generatedAudioData);
        generatedAudioData = null; // reset for next card
        return;
    }

    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => handleData(ev.target.result);
        reader.readAsDataURL(file);
    } else {
        // if no new file picked and editing, keep previous audioData
        if (editingCardId) {
            const existing = cards.find(c => c.id === editingCardId);
            handleData(existing ? existing.audioData : null);
        } else {
            handleData(null);
        }
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
    if (promptInput) promptInput.value = '';
    questionInput.value = '';
    answerInput.value = '';
    audioInput.value = '';

    alert('Card saved!');

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
    audioInput.value = '';

    alert('Card updated!');

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
    clearTimeout(audioLoopTimeout);
    audioLoopTimeout = null;
    cardAudio.pause();
    cardAudio.onended = null;

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

        cardAudio.onended = () => {
            audioLoopTimeout = setTimeout(() => {
                cardAudio.currentTime = 0;
                cardAudio.play().catch(() => {/* autoplay may be blocked */});
            }, 5000); // 5-second pause before replay
        };

        cardAudio.play().catch(() => {/* autoplay might be blocked */});
    } else {
        cardAudio.removeAttribute('src');
        cardAudio.load();
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
// NOTE: Study mode begins when the user clicks the “Study” nav button.
