// EmotionJournal - AI-based journaling with emotional analysis
// 🔹 Emotion dictionary (grouped)
const emotionSynonyms = {
    fear: {
        strong: ["terrified", "panic", "horrified"],
        medium: ["afraid", "scared", "anxious"],
        weak: ["worried", "nervous"]
    },
    sadness: {
        strong: ["depressed", "heartbroken"],
        medium: ["sad", "crying"],
        weak: ["down", "unhappy"]
    },
    joy: {
        strong: ["ecstatic", "thrilled"],
        medium: ["happy", "excited"],
        weak: ["good", "nice"]
    },
    anger: {
        strong: ["furious", "rage"],
        medium: ["angry", "mad"],
        weak: ["annoyed", "irritated"]
    },
    love: {
        strong: ["adore", "obsessed"],
        medium: ["love"],
        weak: ["care", "like"]
    }
};

// 🔹 Weight map
const weightMap = {
    strong: 3,
    medium: 2,
    weak: 1
};

class EmotionJournal {
    constructor() {
        this.entries = JSON.parse(localStorage.getItem('journalEntries')) || [];
        this.emotionChart = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadDashboard();
        this.updateStats();
    }

    bindEvents() {
        document.getElementById('analyze-btn').addEventListener('click', () => this.analyzeEntry());
        document.getElementById('save-entry-btn').addEventListener('click', () => this.saveEntry());
        document.getElementById('clear-btn').addEventListener('click', () => this.clearEntry());
        document.getElementById('show-all-entries').addEventListener('click', () => this.showAllEntries());
        
        let timeout;
        document.getElementById('journal-text').addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => this.autoSave(), 2000);
        });
    }

    analyzeEntry() {
        const text = document.getElementById('journal-text').value.trim();
        
        if (!text) {
            this.showToast('Please write something first!', 'warning');
            return;
        }

        const analyzeBtn = document.getElementById('analyze-btn');
        const originalText = analyzeBtn.innerHTML;
        analyzeBtn.innerHTML = 'Analyzing...';
        analyzeBtn.disabled = true;

        setTimeout(() => {
            const analysis = this.performEmotionAnalysis(text);
            this.displayAnalysis(analysis);
            this.updateAvatar(analysis.dominantEmotion);
            this.updateEmotionTags(analysis.emotions);

            analyzeBtn.innerHTML = originalText;
            analyzeBtn.disabled = false;

            this.showToast('Analysis complete!', 'success');
        }, 800);
    }

performEmotionAnalysis(text) {
    text = text.toLowerCase();

    const emotions = {
        joy: 0,
        sadness: 0,
        anger: 0,
        fear: 0,
        love: 0
    };

    // 🔹 Weighted detection
    for (let emotion in emotionSynonyms) {
        const levels = emotionSynonyms[emotion];

        for (let level in levels) {
            const words = levels[level];
            const weight = weightMap[level];

            words.forEach(word => {
                const regex = new RegExp(`\\b${word}\\b`);
                if (regex.test(text)) {
                    emotions[emotion] += weight;
                }
            });
        }
    }

    // 🔹 Find dominant emotion
    let dominantEmotion = "neutral";
    let max = 0;

    for (let e in emotions) {
        if (emotions[e] > max) {
            max = emotions[e];
            dominantEmotion = e;
        }
    }

    if (max === 0) dominantEmotion = "neutral";

    return { emotions, dominantEmotion };
}

displayAnalysis(analysis) {
    document.getElementById('analysis-section').style.display = 'block';

    const ctx = document.getElementById('emotion-chart').getContext('2d');

    if (this.emotionChart) this.emotionChart.destroy();

    const emotions = analysis.emotions;

    const labels = [];
    const data = [];
    const colors = [];

    let total = 0;

    // 🔹 total weighted score
    for (let e in emotions) {
        total += emotions[e];
    }

    // 🔹 convert to percentage
    for (let e in emotions) {
        if (emotions[e] > 0) {
            labels.push(e.charAt(0).toUpperCase() + e.slice(1));

            const percent = total > 0
                ? Math.round((emotions[e] / total) * 100)
                : 0;

            data.push(percent);

            // simple colors (you can customize later)
            const colorMap = {
                joy: '#ffc107',
                sadness: '#0dcaf0',
                anger: '#dc3545',
                fear: '#6c757d',
                love: '#e91e63'
            };

            colors.push(colorMap[e] || '#999');
        }
    }

    this.emotionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors
            }]
        }
    });
}

    updateAvatar(emotion) {
        const avatar = document.getElementById('avatar');
        const avatarStatus = document.getElementById('avatar-status');

        avatar.className = 'avatar';
        avatar.classList.add(emotion || 'neutral');

        const names = {
            joy: 'Happy',
            sadness: 'Sad',
            anger: 'Angry',
            fear: 'Scared',
            love: 'Loved',
            neutral: 'Neutral'
        };

        avatarStatus.textContent = names[emotion] || 'Neutral';

        avatar.style.animation = 'none';
        setTimeout(() => {
            avatar.style.animation = 'avatarPulse 2s ease-in-out';
        }, 10);
    }

    updateEmotionTags(emotions) {
        const container = document.getElementById('emotion-tags');
        if (!container) return;

        container.innerHTML = '';

        Object.keys(emotions).forEach(e => {
            if (emotions[e] > 0) {
                const span = document.createElement('span');
                span.textContent = e;
                container.appendChild(span);
            }
        });
    }

    saveEntry() {
        const text = document.getElementById('journal-text').value.trim();
        if (!text) return;

        this.entries.unshift({
            text,
            date: new Date().toISOString()
        });

        localStorage.setItem('journalEntries', JSON.stringify(this.entries));
        this.showToast('Saved!', 'success');
    }

    autoSave() {
        const text = document.getElementById('journal-text').value.trim();
        if (text) localStorage.setItem('currentEntry', text);
    }

    clearEntry() {
        document.getElementById('journal-text').value = '';
        this.showToast('Cleared', 'info');
    }

    loadDashboard() {
        const saved = localStorage.getItem('currentEntry');
        if (saved) document.getElementById('journal-text').value = saved;
    }

    updateStats() {}

    showAllEntries() {}

    showToast(msg) {
        console.log(msg);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new EmotionJournal();
});