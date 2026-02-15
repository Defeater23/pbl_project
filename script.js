// EmotionJournal - AI-based journaling with emotional analysis
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
        
        // Auto-save on typing (debounced)
        let timeout;
        document.getElementById('journal-text').addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => this.autoSave(), 2000);
        });
    }

    // Emotion Analysis Engine
    analyzeEntry() {
        const text = document.getElementById('journal-text').value.trim();
        
        if (!text) {
            this.showToast('Please write something first!', 'warning');
            return;
        }

        // Show loading state
        const analyzeBtn = document.getElementById('analyze-btn');
        const originalText = analyzeBtn.innerHTML;
        analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        analyzeBtn.disabled = true;

        // Simulate API call with setTimeout
        setTimeout(() => {
            const analysis = this.performEmotionAnalysis(text);
            this.displayAnalysis(analysis);
            this.updateAvatar(analysis.dominantEmotion);
            this.updateEmotionTags(analysis.emotions);
            
            // Reset button
            analyzeBtn.innerHTML = originalText;
            analyzeBtn.disabled = false;
            
            this.showToast('Emotional analysis complete!', 'success');
        }, 1500);
    }

    performEmotionAnalysis(text) {
        const words = text.toLowerCase().split(/\s+/);
        
        // Enhanced emotion keywords with weights
        const emotionKeywords = {
            joy: {
                keywords: ['happy', 'joy', 'excited', 'cheerful', 'delighted', 'thrilled', 'elated', 'wonderful', 'amazing', 'fantastic', 'great', 'awesome', 'love', 'beautiful', 'success', 'achievement', 'celebration', 'blessed', 'grateful', 'laughed', 'smile', 'fun', 'enjoyable'],
                weight: 1
            },
            sadness: {
                keywords: ['sad', 'depressed', 'disappointed', 'heartbroken', 'grief', 'sorrow', 'melancholy', 'down', 'blue', 'cry', 'crying', 'tears', 'lonely', 'empty', 'loss', 'miss', 'hurt', 'pain', 'devastated', 'despair'],
                weight: 1
            },
            anger: {
                keywords: ['angry', 'mad', 'furious', 'irritated', 'annoyed', 'frustrated', 'rage', 'hate', 'disgusted', 'outraged', 'livid', 'pissed', 'upset', 'resentful', 'bitter', 'hostile'],
                weight: 1
            },
            fear: {
                keywords: ['scared', 'afraid', 'fearful', 'anxious', 'worried', 'nervous', 'panic', 'terrified', 'frightened', 'concerned', 'stress', 'stressed', 'overwhelmed', 'insecure', 'uncertain', 'doubt'],
                weight: 1
            },
            surprise: {
                keywords: ['surprised', 'shocked', 'amazed', 'astonished', 'unexpected', 'sudden', 'wow', 'incredible', 'unbelievable', 'stunned'],
                weight: 0.8
            },
            love: {
                keywords: ['love', 'adore', 'cherish', 'affection', 'romantic', 'relationship', 'partner', 'family', 'care', 'tender', 'devoted', 'passion'],
                weight: 1.2
            },
            hope: {
                keywords: ['hope', 'optimistic', 'positive', 'future', 'dream', 'goal', 'aspire', 'believe', 'faith', 'confidence', 'better', 'improve'],
                weight: 1
            },
            gratitude: {
                keywords: ['grateful', 'thankful', 'appreciate', 'blessed', 'fortunate', 'thank', 'thanks', 'appreciation'],
                weight: 1.1
            }
        };

        // Trigger words (negative patterns)
        const triggerWords = ['stress', 'pressure', 'deadline', 'conflict', 'argument', 'failure', 'criticism', 'rejection', 'loss', 'worry', 'anxiety', 'depression', 'overwhelmed', 'tired', 'exhausted'];
        
        // Glimmer words (positive patterns)
        const glimmerWords = ['success', 'achievement', 'compliment', 'support', 'kindness', 'breakthrough', 'progress', 'celebration', 'friendship', 'love', 'inspiration', 'creativity', 'peace', 'calm'];

        const emotions = {};
        let totalScore = 0;

        // Calculate emotion scores
        Object.keys(emotionKeywords).forEach(emotion => {
            let score = 0;
            const { keywords, weight } = emotionKeywords[emotion];
            
            keywords.forEach(keyword => {
                const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                const matches = text.match(regex);
                if (matches) {
                    score += matches.length * weight;
                }
            });
            
            emotions[emotion] = score;
            totalScore += score;
        });

        // Normalize scores to percentages
        if (totalScore > 0) {
            Object.keys(emotions).forEach(emotion => {
                emotions[emotion] = Math.round((emotions[emotion] / totalScore) * 100);
            });
        }

        // Find dominant emotion
        const dominantEmotion = Object.keys(emotions).reduce((a, b) => 
            emotions[a] > emotions[b] ? a : b
        );

        // Detect triggers and glimmers
        const triggers = this.findPatterns(text, triggerWords, 'trigger');
        const glimmers = this.findPatterns(text, glimmerWords, 'glimmer');

        // Generate insights
        const insights = this.generateInsights(emotions, dominantEmotion, triggers, glimmers);

        return {
            emotions,
            dominantEmotion,
            triggers,
            glimmers,
            insights,
            sentiment: this.calculateOverallSentiment(emotions)
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

    calculateOverallSentiment(emotions) {
        const positiveEmotions = ['joy', 'love', 'hope', 'gratitude'];
        const negativeEmotions = ['sadness', 'anger', 'fear'];
        
        let positiveScore = 0;
        let negativeScore = 0;
        
        positiveEmotions.forEach(emotion => {
            positiveScore += emotions[emotion] || 0;
        });
        
        negativeEmotions.forEach(emotion => {
            negativeScore += emotions[emotion] || 0;
        });
        
        if (positiveScore > negativeScore * 1.2) return 'positive';
        if (negativeScore > positiveScore * 1.2) return 'negative';
        return 'neutral';
    }

    generateInsights(emotions, dominantEmotion, triggers, glimmers) {
        const insights = [];
        
        // Dominant emotion insights
        const emotionInsights = {
            joy: "You're experiencing a lot of joy today! This positive energy can be contagious and beneficial for your overall well-being.",
            sadness: "It's okay to feel sad sometimes. These feelings are valid and part of the human experience. Consider reaching out to someone you trust.",
            anger: "You seem to be dealing with some frustration. Try taking deep breaths and identifying what's causing these feelings.",
            fear: "Anxiety and worry are common. Remember that it's okay to take things one step at a time.",
            love: "Love and connection seem to be prominent in your thoughts. These relationships are precious - nurture them.",
            hope: "Your optimistic outlook is a strength. Hold onto this hope as it can guide you through challenges.",
            gratitude: "Your grateful heart is beautiful. This appreciation for life's gifts contributes to your happiness."
        };

        if (emotions[dominantEmotion] > 20) {
            insights.push(emotionInsights[dominantEmotion] || "Your emotional state shows interesting patterns worth exploring.");
        }

        // Trigger insights
        if (triggers.length > 0) {
            insights.push(`I noticed ${triggers.length} potential stress trigger${triggers.length > 1 ? 's' : ''} in your entry. Identifying these patterns can help you manage them better.`);
        }

        // Glimmer insights
        if (glimmers.length > 0) {
            insights.push(`Great news! I found ${glimmers.length} positive moment${glimmers.length > 1 ? 's' : ''} in your writing. These 'glimmers' are important for your emotional well-being.`);
        }

        // Balance insights
        const positiveCount = (emotions.joy || 0) + (emotions.love || 0) + (emotions.hope || 0) + (emotions.gratitude || 0);
        const negativeCount = (emotions.sadness || 0) + (emotions.anger || 0) + (emotions.fear || 0);
        
        if (positiveCount > negativeCount * 2) {
            insights.push("Your emotional balance seems quite positive today. This is wonderful for your mental health!");
        } else if (negativeCount > positiveCount * 2) {
            insights.push("You might be experiencing some challenging emotions. Remember, it's okay to seek support when you need it.");
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

    // Avatar System
    updateAvatar(emotion) {
        const avatar = document.getElementById('avatar');
        const avatarStatus = document.getElementById('avatar-status');
        
        // Remove all emotion classes
        avatar.className = 'avatar';
        
        // Add new emotion class
        avatar.classList.add(emotion || 'neutral');
        
        // Update status text
        const emotionNames = {
            joy: 'Joyful & Happy',
            sadness: 'Feeling Sad',
            anger: 'Feeling Angry',
            fear: 'Anxious & Worried',
            surprise: 'Surprised',
            love: 'Feeling Loved',
            hope: 'Hopeful & Optimistic',
            gratitude: 'Grateful & Thankful',
            neutral: 'Neutral Mood'
        };
        
        avatarStatus.textContent = emotionNames[emotion] || 'Neutral Mood';
        
        // Add animation
        avatar.style.animation = 'none';
        setTimeout(() => {
            avatar.style.animation = 'avatarPulse 2s ease-in-out';
        }, 10);
    }

    updateEmotionTags(emotions) {
        const tagsContainer = document.getElementById('emotion-tags');
        tagsContainer.innerHTML = '';
        
        Object.keys(emotions).forEach(emotion => {
            if (emotions[emotion] > 15) { // Only show significant emotions
                const tag = document.createElement('span');
                tag.className = `emotion-tag ${emotion}`;
                tag.textContent = `${this.capitalizeFirst(emotion)} ${emotions[emotion]}%`;
                tagsContainer.appendChild(tag);
            }
        });
        
        if (tagsContainer.innerHTML === '') {
            tagsContainer.innerHTML = '<span class="text-muted">Write more to see emotions</span>';
        }
    }

    // Data Management
    saveEntry() {
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
        if (analysisSection.style.display !== 'none') {
            // Re-analyze for saving
            entry.analysis = this.performEmotionAnalysis(text);
        }

        this.entries.unshift(entry);
        localStorage.setItem('journalEntries', JSON.stringify(this.entries));
        
        this.updateStats();
        this.loadRecentEntries();
        this.showToast('Entry saved successfully!', 'success');
        
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
        this.showToast('Entry cleared!', 'info');
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
                    .filter(emotion => entry.analysis.emotions[emotion] > 20)
                    .slice(0, 3);
                
                emotionBadges = topEmotions.map(emotion => 
                    `<span class="badge emotion-badge ${emotion}">${this.capitalizeFirst(emotion)}</span>`
                ).join(' ');
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
        
        if (recentAnalyzedEntries.length > 0) {
            const sentiments = recentAnalyzedEntries.map(entry => entry.analysis.sentiment);
            const positiveCount = sentiments.filter(s => s === 'positive').length;
            const negativeCount = sentiments.filter(s => s === 'negative').length;
            
            let overallMood = 'Neutral';
            if (positiveCount > negativeCount) overallMood = 'Positive';
            else if (negativeCount > positiveCount) overallMood = 'Negative';
            
            document.getElementById('overall-mood').textContent = overallMood;
        }
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
        const colors = {
            joy: 'warning',
            sadness: 'info',
            anger: 'danger',
            fear: 'secondary',
            surprise: 'primary',
            love: 'danger',
            hope: 'success',
            gratitude: 'success'
        };
        return colors[emotion] || 'secondary';
    }

    getEmotionColorHex(emotion) {
        const colors = {
            joy: '#ffc107',
            sadness: '#0dcaf0',
            anger: '#dc3545',
            fear: '#6c757d',
            surprise: '#0d6efd',
            love: '#e91e63',
            hope: '#198754',
            gratitude: '#20c997'
        };
        return colors[emotion] || '#6c757d';
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
