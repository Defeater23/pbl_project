// EmoStar — journal storage via API; emotion scores from GoEmotions dataset lexicon (server).

/** Maps each GoEmotions label → avatar “skin” (existing CSS: joy, sadness, anger, fear, love, hope, gratitude, surprise, neutral). */
const GO_TO_AVATAR_SKIN = {
    admiration: 'gratitude',
    amusement: 'joy',
    anger: 'anger',
    annoyance: 'anger',
    approval: 'hope',
    caring: 'love',
    confusion: 'surprise',
    curiosity: 'surprise',
    desire: 'love',
    disappointment: 'sadness',
    disapproval: 'anger',
    disgust: 'anger',
    embarrassment: 'fear',
    excitement: 'joy',
    fear: 'fear',
    gratitude: 'gratitude',
    grief: 'sadness',
    joy: 'joy',
    love: 'love',
    nervousness: 'fear',
    optimism: 'hope',
    pride: 'joy',
    realization: 'surprise',
    relief: 'gratitude',
    remorse: 'sadness',
    sadness: 'sadness',
    surprise: 'surprise',
    neutral: 'neutral',
};

const GO_POSITIVE_LABELS = new Set([
    'admiration', 'amusement', 'approval', 'caring', 'excitement', 'gratitude', 'joy', 'love',
    'optimism', 'pride', 'relief', 'desire', 'curiosity',
]);
const GO_NEGATIVE_LABELS = new Set([
    'anger', 'annoyance', 'disappointment', 'disapproval', 'disgust', 'embarrassment', 'fear',
    'grief', 'nervousness', 'remorse', 'sadness',
]);

class EmotionJournal {
    constructor() {
        this.entries = [];
        this.emotionChart = null;
        this.apiBase = EmotionJournal.resolveApiBase();
        this.apiConnected = false;
        this.lastAnalysis = null;
        /** @type {'mongodb'|'mongo_down'|'offline'} */
        this.entryStorageMode = 'offline';
        this.bootstrap();
    }

    /** Same-origin when served by Node; file:// defaults to localhost:3000; override with meta tag emostar-api-base. */
    static resolveApiBase() {
        const meta = document.querySelector('meta[name="emostar-api-base"]');
        const fromMeta = meta && meta.content.trim();
        if (fromMeta) return fromMeta.replace(/\/$/, '');
        if (typeof location !== 'undefined' && location.protocol === 'file:') {
            return 'http://127.0.0.1:3000';
        }
        // Live Preview / Vite / etc. serve HTML on another port; EmoStar API stays on npm start (default 3000).
        if (typeof location !== 'undefined' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
            const port = parseInt(location.port, 10) || (location.protocol === 'https:' ? 443 : 80);
            const previewPorts = new Set([5500, 5501, 5173, 4173, 8080, 8888, 1234]);
            if (previewPorts.has(port)) {
                return 'http://127.0.0.1:3000';
            }
        }
        return '';
    }

    static formatGoEmotionsAnalyzeError(e) {
        const raw = e instanceof Error ? e.message : String(e);
        if (raw === 'API_HTML_RESPONSE' || raw.includes('API_HTML_RESPONSE')) {
            return 'The analyze URL returned a web page instead of data. If you use Live Preview, set in index.html: <meta name="emostar-api-base" content="http://127.0.0.1:3000"> (use the port from npm start), then reload. Otherwise open the app only at that same URL.';
        }
        if (raw.includes('Unexpected token') && raw.includes('<!DOCTYPE')) {
            return 'Same issue: the request hit a server that sent HTML (not the EmoStar API). Use the URL printed by npm start in server/, or set meta emostar-api-base to it.';
        }
        if (raw.includes('goemotions_lexicon_unavailable')) {
            return 'Server is missing server/data/emotion_words.csv. Copy it from the GoEmotions dataset into that path, then restart npm start.';
        }
        try {
            const j = JSON.parse(raw);
            if (j.error === 'goemotions_lexicon_unavailable') {
                return 'Server is missing server/data/emotion_words.csv. Copy emotion_words.csv there and restart npm start.';
            }
            if (j.error) return `Analysis API: ${j.error}`;
        } catch {
            /* not JSON */
        }
        const isNetwork =
            (typeof TypeError !== 'undefined' && e instanceof TypeError) ||
            /Failed to fetch|Load failed|NetworkError/i.test(raw);
        if (isNetwork) {
            return 'Cannot reach the EmoStar API. Open http://127.0.0.1:3000 (after npm start in server/) or set meta emostar-api-base to your server URL if you use Live Preview on another port.';
        }
        if (raw && raw.length < 160) return `GoEmotions analysis failed: ${raw}`;
        return 'GoEmotions analysis failed. Run npm start in server/ and open the printed URL.';
    }

    async bootstrap() {
        await this.loadEntriesFromApi();
        this.bindEvents();
        this.loadDashboard();
        this.updateStats();
        this.updateDbStatus();
    }

    updateDbStatus() {
        const el = document.getElementById('db-status');
        if (!el) return;
        el.classList.remove('text-success', 'text-warning', 'text-info');
        if (this.entryStorageMode === 'mongodb') {
            el.textContent = 'Entries saved to MongoDB';
            el.classList.add('text-success');
        } else if (this.entryStorageMode === 'mongo_down') {
            el.textContent = 'Server running — start MongoDB to persist journals';
            el.classList.add('text-warning');
        } else {
            el.textContent = 'Browser-only — open http://127.0.0.1:3000 (npm start in server/)';
            el.classList.add('text-warning');
        }
    }

    async loadEntriesFromApi() {
        const raw = localStorage.getItem('journalEntries');
        const fromFile = typeof location !== 'undefined' && location.protocol === 'file:';

        try {
            const res = await fetch(`${this.apiBase}/api/journal-entries`);
            if (res.ok) {
                this.entries = await res.json();
                this.apiConnected = true;
                this.entryStorageMode = 'mongodb';

                if (this.entries.length === 0 && raw) {
                    const local = JSON.parse(raw);
                    if (Array.isArray(local) && local.length) {
                        for (const e of local) {
                            await fetch(`${this.apiBase}/api/journal-entries`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(e),
                            });
                        }
                        localStorage.removeItem('journalEntries');
                        const again = await fetch(`${this.apiBase}/api/journal-entries`);
                        if (again.ok) this.entries = await again.json();
                        this.showToast('Previous browser entries were copied to MongoDB.', 'success');
                    }
                }
                return;
            }

            this.apiConnected = false;
            this.entries = raw ? JSON.parse(raw) : [];

            if (res.status === 503) {
                this.entryStorageMode = 'mongo_down';
                this.showToast(
                    'EmoStar server is running, but MongoDB is not available. Journals stay in this browser until MongoDB is reachable.',
                    'warning',
                );
            } else {
                this.entryStorageMode = 'offline';
                this.showToast(
                    `Journal API returned HTTP ${res.status}. Using browser storage for now.`,
                    'warning',
                );
            }
            return;
        } catch {
            this.apiConnected = false;
            this.entries = raw ? JSON.parse(raw) : [];
            this.entryStorageMode = 'offline';

            if (fromFile) {
                this.showToast(
                    'Open EmoStar at http://127.0.0.1:3000 after running npm start in the server folder. Saving the HTML file directly cannot reach MongoDB.',
                    'info',
                );
            } else {
                this.showToast(
                    'Could not reach the EmoStar API. Run npm start in server/, then reload. If the server is already up, start MongoDB (or check PORT).',
                    'warning',
                );
            }
        }
    }

    bindEvents() {
        document.getElementById('analyze-btn').addEventListener('click', () => this.analyzeEntry());
        document.getElementById('save-entry-btn').addEventListener('click', () => this.saveEntry());
        document.getElementById('clear-btn').addEventListener('click', () => this.clearEntry());
        document.getElementById('show-all-entries').addEventListener('click', () => this.showAllEntries());
        
        // Auto-save on typing (debounced)
        let timeout;
        document.getElementById('journal-text').addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => this.autoSave(), 2000);
        });
    }

    async analyzeEntry() {
        const text = document.getElementById('journal-text').value.trim();

        if (!text) {
            this.showToast('Please write something first!', 'warning');
            return;
        }

        const analyzeBtn = document.getElementById('analyze-btn');
        const originalText = analyzeBtn.innerHTML;
        analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        analyzeBtn.disabled = true;

        try {
            const res = await fetch(`${this.apiBase}/api/goemotions-analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });
            const rawBody = await res.text();
            if (!res.ok) {
                throw new Error(rawBody || res.statusText);
            }
            let go;
            try {
                go = JSON.parse(rawBody);
            } catch {
                const looksLikeHtml = rawBody.trimStart().toLowerCase().startsWith("<!doctype") || rawBody.trimStart().startsWith("<html");
                throw new Error(
                    looksLikeHtml
                        ? "API_HTML_RESPONSE"
                        : `Invalid JSON from server: ${rawBody.slice(0, 120)}`,
                );
            }
            const { triggers, glimmers } = this.getTriggersGlimmers(text);
            const analysis = {
                emotions: go.emotions,
                dominantEmotion: go.dominant,
                sentiment: go.sentiment,
                triggers,
                glimmers,
                insights: this.generateInsights({
                    emotions: go.emotions,
                    dominantEmotion: go.dominant,
                    sentiment: go.sentiment,
                    triggers,
                    glimmers,
                }),
                source: go.source,
            };
            this.lastAnalysis = analysis;
            this.displayAnalysis(analysis);
            this.updateAvatar(go.dominant);
            this.updateEmotionTags(analysis.emotions);
            
            // Instantly update background theme based on current entry sentiment
            let currentMood = 'Neutral';
            const s = (analysis.sentiment || '').toLowerCase();
            if (s === 'positive') currentMood = 'Positive';
            else if (s === 'negative') currentMood = 'Negative';
            else {
                let p = 0, n = 0;
                Object.keys(analysis.emotions || {}).forEach(e => {
                    const val = analysis.emotions[e];
                    if (GO_POSITIVE_LABELS.has(e)) p += val;
                    if (GO_NEGATIVE_LABELS.has(e)) n += val;
                });
                if (p > n) currentMood = 'Positive';
                else if (n > p) currentMood = 'Negative';
            }
            document.body.className = `theme-${currentMood.toLowerCase()}`;
            
            // Also instantly update the text in the 'Your Progress' sidebar so users see it change!
            document.getElementById('overall-mood').textContent = this.capitalizeFirst(currentMood);
            
            this.showToast('GoEmotions lexicon analysis complete!', 'success');
        } catch (e) {
            this.lastAnalysis = null;
            this.showToast(EmotionJournal.formatGoEmotionsAnalyzeError(e), 'warning');
        } finally {
            analyzeBtn.innerHTML = originalText;
            analyzeBtn.disabled = false;
        }
    }

    getTriggersGlimmers(text) {
        const triggerWords = ['stress', 'pressure', 'deadline', 'conflict', 'argument', 'failure', 'criticism', 'rejection', 'loss', 'worry', 'anxiety', 'depression', 'overwhelmed', 'tired', 'exhausted'];
        const glimmerWords = ['success', 'achievement', 'compliment', 'support', 'kindness', 'breakthrough', 'progress', 'celebration', 'friendship', 'love', 'inspiration', 'creativity', 'peace', 'calm'];
        return {
            triggers: this.findPatterns(text, triggerWords, 'trigger'),
            glimmers: this.findPatterns(text, glimmerWords, 'glimmer'),
        };
    }

    findPatterns(text, keywords, type) {
        const patterns = [];
        const sentences = text.split(/[.!?]+/);
        
        keywords.forEach(keyword => {
            sentences.forEach(sentence => {
                if (sentence.toLowerCase().includes(keyword)) {
                    patterns.push({
                        keyword,
                        context: sentence.trim(),
                        type
                    });
                }
            });
        });
        
        return patterns;
    }

    generateInsights({ emotions, dominantEmotion, sentiment, triggers, glimmers }) {
        const insights = [];
        const domPct = emotions[dominantEmotion] || 0;
        if (domPct > 0) {
            insights.push(
                `The GoEmotions word-odds lexicon (from the same project as the dataset) puts the strongest signal on ${this.capitalizeFirst(dominantEmotion)} (${domPct}% of matched weight in your text).`,
            );
        }

        if (triggers.length > 0) {
            insights.push(`I noticed ${triggers.length} potential stress trigger${triggers.length > 1 ? 's' : ''} in your entry. Identifying these patterns can help you manage them better.`);
        }

        if (glimmers.length > 0) {
            insights.push(`I found ${glimmers.length} positive moment${glimmers.length > 1 ? 's' : ''} in your writing—small bright spots worth noticing.`);
        }

        let pos = 0;
        let neg = 0;
        Object.keys(emotions).forEach((e) => {
            const v = emotions[e] || 0;
            if (GO_POSITIVE_LABELS.has(e)) pos += v;
            if (GO_NEGATIVE_LABELS.has(e)) neg += v;
        });
        if (pos > neg * 2) {
            insights.push('Across GoEmotions categories, the positive-leaning signals outweigh the negative ones in this entry.');
        } else if (neg > pos * 2) {
            insights.push('Across GoEmotions categories, heavier negative-leaning signals show up in this entry. It is okay to pause and take care of yourself.');
        } else if (sentiment === 'positive') {
            insights.push('Overall valence from the GoEmotions mix reads slightly positive.');
        } else if (sentiment === 'negative') {
            insights.push('Overall valence from the GoEmotions mix reads slightly negative.');
        }

        return insights;
    }

    displayAnalysis(analysis) {
        // Show analysis section
        document.getElementById('analysis-section').style.display = 'block';
        
        // Display emotion breakdown
        const breakdownDiv = document.getElementById('emotion-breakdown');
        breakdownDiv.innerHTML = '';
        
        Object.keys(analysis.emotions).forEach(emotion => {
            const score = analysis.emotions[emotion];
            if (score > 0) {
                const emotionItem = document.createElement('div');
                emotionItem.className = 'emotion-item mb-2';
                emotionItem.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="emotion-name">${this.capitalizeFirst(emotion)}</span>
                        <span class="emotion-score">${score}%</span>
                    </div>
                    <div class="progress" style="height: 6px;">
                        <div class="progress-bar bg-${this.getEmotionColor(emotion)}" 
                             style="width: ${score}%"></div>
                    </div>
                `;
                breakdownDiv.appendChild(emotionItem);
            }
        });

        // Create emotion chart
        this.createEmotionChart(analysis.emotions);
        
        // Display triggers
        const triggersList = document.getElementById('triggers-list');
        triggersList.innerHTML = '';
        if (analysis.triggers.length > 0) {
            analysis.triggers.forEach(trigger => {
                const triggerItem = document.createElement('div');
                triggerItem.className = 'alert alert-warning alert-sm';
                triggerItem.innerHTML = `<strong>${trigger.keyword}</strong>: ${trigger.context}`;
                triggersList.appendChild(triggerItem);
            });
        } else {
            triggersList.innerHTML = '<p class="text-muted">No stress triggers detected. Great job!</p>';
        }

        // Display glimmers
        const glimmersList = document.getElementById('glimmers-list');
        glimmersList.innerHTML = '';
        if (analysis.glimmers.length > 0) {
            analysis.glimmers.forEach(glimmer => {
                const glimmerItem = document.createElement('div');
                glimmerItem.className = 'alert alert-success alert-sm';
                glimmerItem.innerHTML = `<strong>${glimmer.keyword}</strong>: ${glimmer.context}`;
                glimmersList.appendChild(glimmerItem);
            });
        } else {
            glimmersList.innerHTML = '<p class="text-muted">No specific positive moments detected, but that doesn\'t mean they weren\'t there!</p>';
        }

        // Scroll to analysis
        document.getElementById('analysis-section').scrollIntoView({ behavior: 'smooth' });
    }

    createEmotionChart(emotions) {
        const ctx = document.getElementById('emotion-chart').getContext('2d');
        
        // Destroy existing chart
        if (this.emotionChart) {
            this.emotionChart.destroy();
        }

        const labels = [];
        const data = [];
        const colors = [];

        Object.keys(emotions).forEach(emotion => {
            if (emotions[emotion] > 0) {
                labels.push(this.capitalizeFirst(emotion));
                data.push(emotions[emotion]);
                colors.push(this.getEmotionColorHex(emotion));
            }
        });

        this.emotionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            font: {
                                size: 12
                            }
                        }
                    }
                },
                cutout: '60%'
            }
        });
    }

    // Avatar System — driven by dominant GoEmotions label; look uses mapped “skin” styles.
    updateAvatar(goDominant) {
        const avatar = document.getElementById('avatar');
        const avatarStatus = document.getElementById('avatar-status');
        const label = (goDominant || 'neutral').toLowerCase();
        const skin = GO_TO_AVATAR_SKIN[label] || 'neutral';

        avatar.className = 'avatar';
        avatar.classList.add(skin);
        avatar.dataset.goEmotion = label;

        avatarStatus.textContent = `GoEmotions: ${this.capitalizeFirst(label)}`;

        avatar.style.animation = 'none';
        setTimeout(() => {
            avatar.style.animation = 'avatarPulse 2s ease-in-out';
        }, 10);
    }

    updateEmotionTags(emotions) {
        const tagsContainer = document.getElementById('emotion-tags');
        tagsContainer.innerHTML = '';

        Object.keys(emotions).forEach((emotion) => {
            if (emotions[emotion] > 8) {
                const tag = document.createElement('span');
                tag.className = 'emotion-tag';
                tag.style.background = this.getEmotionColorHex(emotion);
                tag.style.color = '#fff';
                tag.textContent = `${this.capitalizeFirst(emotion)} ${emotions[emotion]}%`;
                tagsContainer.appendChild(tag);
            }
        });

        if (tagsContainer.innerHTML === '') {
            tagsContainer.innerHTML = '<span class="text-muted">Write more to see dataset-aligned signals</span>';
        }
    }

    // Data Management
    async saveEntry() {
        const text = document.getElementById('journal-text').value.trim();
        
        if (!text) {
            this.showToast('Please write something first!', 'warning');
            return;
        }

        const entry = {
            id: Date.now(),
            text: text,
            date: new Date().toISOString(),
            timestamp: Date.now()
        };

        // Add analysis if available
        const analysisSection = document.getElementById('analysis-section');
        if (analysisSection.style.display !== 'none' && this.lastAnalysis) {
            entry.analysis = this.lastAnalysis;
        }

        const saveBtn = document.getElementById('save-entry-btn');
        const originalSave = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
            if (this.apiConnected) {
                const res = await fetch(`${this.apiBase}/api/journal-entries`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry),
                });
                if (!res.ok) throw new Error(await res.text());
                const saved = await res.json();
                this.entries.unshift(saved);
                this.showToast('Entry saved to MongoDB!', 'success');
            } else {
                this.entries.unshift(entry);
                localStorage.setItem('journalEntries', JSON.stringify(this.entries));
                this.showToast('Entry saved in this browser.', 'success');
            }
        } catch {
            this.apiConnected = false;
            this.entries.unshift(entry);
            localStorage.setItem('journalEntries', JSON.stringify(this.entries));
            this.updateDbStatus();
            this.showToast('Database unavailable — saved in this browser only.', 'warning');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalSave;
        }
        
        this.updateStats();
        this.loadRecentEntries();
        
        // Clear the form
        document.getElementById('journal-text').value = '';
        document.getElementById('analysis-section').style.display = 'none';
    }

    autoSave() {
        const text = document.getElementById('journal-text').value.trim();
        if (text) {
            localStorage.setItem('currentEntry', text);
        }
    }

    clearEntry() {
        document.getElementById('journal-text').value = '';
        document.getElementById('analysis-section').style.display = 'none';
        localStorage.removeItem('currentEntry');
        this.lastAnalysis = null;
        this.showToast('Entry cleared!', 'info');
        
        // Revert overall mood and background back to the historical baseline
        this.updateStats();
    }

    loadDashboard() {
        // Load current entry if exists
        const currentEntry = localStorage.getItem('currentEntry');
        if (currentEntry) {
            document.getElementById('journal-text').value = currentEntry;
        }
        
        this.loadRecentEntries();
    }

    loadRecentEntries() {
        const historyDiv = document.getElementById('journal-history');
        const recentEntries = this.entries.slice(0, 5);
        
        if (recentEntries.length === 0) {
            historyDiv.innerHTML = '<p class="text-muted">No entries yet. Start writing to see your emotional journey!</p>';
            return;
        }

        historyDiv.innerHTML = '';
        recentEntries.forEach(entry => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'journal-entry-item';
            
            const date = new Date(entry.date).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const preview = entry.text.length > 100 ? entry.text.substring(0, 100) + '...' : entry.text;
            
            let emotionBadges = '';
            if (entry.analysis) {
                const topEmotions = Object.keys(entry.analysis.emotions)
                    .filter((emotion) => entry.analysis.emotions[emotion] > 8)
                    .slice(0, 3);
                
                emotionBadges = topEmotions
                    .map(
                        (emotion) =>
                            `<span class="badge emotion-badge" style="background:${this.getEmotionColorHex(emotion)};color:#fff">${this.capitalizeFirst(emotion)}</span>`,
                    )
                    .join(' ');
            }
            
            entryDiv.innerHTML = `
                <div class="entry-header">
                    <small class="text-muted">${date}</small>
                    ${emotionBadges}
                </div>
                <p class="entry-preview">${preview}</p>
            `;
            
            historyDiv.appendChild(entryDiv);
        });
    }

    updateStats() {
        // Entries today
        const today = new Date().toDateString();
        const todayEntries = this.entries.filter(entry => 
            new Date(entry.date).toDateString() === today
        ).length;
        document.getElementById('entries-today').textContent = todayEntries;

        // Streak calculation (simplified)
        let streak = 0;
        const dates = [...new Set(this.entries.map(entry => 
            new Date(entry.date).toDateString()
        ))].sort((a, b) => new Date(b) - new Date(a));
        
        let currentDate = new Date();
        for (let date of dates) {
            if (new Date(date).toDateString() === currentDate.toDateString()) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                break;
            }
        }
        document.getElementById('streak-count').textContent = streak;

        // Overall mood (from recent entries with analysis)
        const recentAnalyzedEntries = this.entries
            .filter(entry => entry.analysis)
            .slice(0, 10);
        
        let overallMood = 'Neutral';
        if (recentAnalyzedEntries.length > 0) {
            let posScore = 0;
            let negScore = 0;
            
            recentAnalyzedEntries.forEach(entry => {
                const s = (entry.analysis.sentiment || '').toLowerCase();
                if (s === 'positive') posScore++;
                else if (s === 'negative') negScore++;
                else {
                    let p = 0, n = 0;
                    Object.keys(entry.analysis.emotions || {}).forEach(e => {
                        const val = entry.analysis.emotions[e];
                        if (GO_POSITIVE_LABELS.has(e)) p += val;
                        if (GO_NEGATIVE_LABELS.has(e)) n += val;
                    });
                    if (p > n) posScore++;
                    else if (n > p) negScore++;
                }
            });
            
            if (posScore > negScore) overallMood = 'Positive';
            else if (negScore > posScore) overallMood = 'Negative';
        }
        
        document.getElementById('overall-mood').textContent = overallMood;
        
        // Dynamically change the app theme to match the overall mood
        document.body.className = `theme-${overallMood.toLowerCase()}`;
    }

    showAllEntries() {
        // This would typically open a modal or navigate to a full history page
        this.showToast('Feature coming soon: Full entry history view!', 'info');
    }

    // Utility functions
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    getEmotionColor(emotion) {
        const skin = GO_TO_AVATAR_SKIN[(emotion || '').toLowerCase()] || 'neutral';
        const colors = {
            joy: 'warning',
            sadness: 'info',
            anger: 'danger',
            fear: 'secondary',
            surprise: 'primary',
            love: 'danger',
            hope: 'success',
            gratitude: 'success',
            neutral: 'secondary',
        };
        return colors[skin] || 'secondary';
    }

    getEmotionColorHex(emotion) {
        const skin = GO_TO_AVATAR_SKIN[(emotion || '').toLowerCase()] || 'neutral';
        const colors = {
            joy: '#ffc107',
            sadness: '#0dcaf0',
            anger: '#dc3545',
            fear: '#6c757d',
            surprise: '#0d6efd',
            love: '#e91e63',
            hope: '#198754',
            gratitude: '#20c997',
            neutral: '#adb5bd',
        };
        return colors[skin] || '#6c757d';
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastBody = document.getElementById('toast-body');
        
        toastBody.textContent = message;
        
        // Update toast styling based on type
        toast.className = `toast text-bg-${type}`;
        
        const bsToast = new bootstrap.Toast(toast);
        bsToast.show();
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.emotionJournal = new EmotionJournal();
});
