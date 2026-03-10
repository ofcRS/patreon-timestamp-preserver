// Video Timestamp Preserver - Popup Script

document.addEventListener('DOMContentLoaded', init);

function init() {
  loadVideos();
  setupTabs();
  setupClearAll();
}

// Format seconds to HH:MM:SS
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Format duration in human-readable form (e.g., "8h 23m")
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

// Format relative time
function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

// Load and display videos
async function loadVideos() {
  const result = await chrome.storage.local.get('videos');
  const videos = result.videos || {};

  const inProgressList = document.getElementById('in-progress-list');
  const completedList = document.getElementById('completed-list');

  // Sort videos by last watched
  const sortedVideos = Object.entries(videos)
    .sort((a, b) => b[1].lastWatched - a[1].lastWatched);

  const inProgress = sortedVideos.filter(([, v]) => !v.completed);
  const completed = sortedVideos.filter(([, v]) => v.completed);

  inProgressList.innerHTML = inProgress.length
    ? inProgress.map(([key, video]) => createVideoCard(key, video, false)).join('')
    : createEmptyState('No videos in progress', 'Start watching a video to track it here.');

  completedList.innerHTML = completed.length
    ? completed.map(([key, video]) => createVideoCard(key, video, true)).join('')
    : createEmptyState('No completed videos', 'Videos watched to 95%+ will appear here.');

  // Attach event listeners
  attachVideoListeners();
}

// Create video card HTML
function createVideoCard(key, video, isCompleted) {
  const progressPercent = Math.min(100, video.progress || 0);
  const creatorHtml = video.creator ? `<div class="video-creator">by ${escapeHtml(video.creator)}</div>` : '';
  const postDateHtml = video.postDate ? `<span class="video-post-date">${escapeHtml(video.postDate)}</span>` : '';

  return `
    <div class="video-item" data-key="${encodeURIComponent(key)}" data-url="${encodeURIComponent(video.url)}">
      <div class="video-title">${escapeHtml(video.title)}</div>
      ${creatorHtml}
      <div class="video-duration-badge">${formatDuration(video.duration)} total</div>
      <div class="video-meta">
        <span class="video-timestamp">${formatTime(video.peakTimestamp || video.timestamp)} / ${formatTime(video.duration)}</span>
        <span class="video-progress-text">${progressPercent.toFixed(1)}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progressPercent}%"></div>
      </div>
      <div class="video-footer">
        <span class="last-watched">Last watched: ${formatRelativeTime(video.lastWatched)}</span>
        ${postDateHtml}
      </div>
      <div class="video-actions">
        ${isCompleted
          ? `<button class="btn-action btn-rewatch" data-action="rewatch">Mark In Progress</button>`
          : `<button class="btn-action btn-complete" data-action="complete">Mark Complete</button>`
        }
        <button class="btn-action btn-remove" data-action="remove">Remove</button>
      </div>
    </div>
  `;
}

// Create empty state HTML
function createEmptyState(title, subtitle) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">📺</div>
      <div class="empty-state-text">
        <strong>${title}</strong><br>
        ${subtitle}
      </div>
    </div>
  `;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Attach event listeners to video items
function attachVideoListeners() {
  // Click on video card to open URL
  document.querySelectorAll('.video-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't navigate if clicking on action buttons
      if (e.target.closest('.video-actions')) return;

      const url = decodeURIComponent(item.dataset.url);
      chrome.tabs.create({ url });
    });
  });

  // Action buttons
  document.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const item = btn.closest('.video-item');
      const key = decodeURIComponent(item.dataset.key);
      const action = btn.dataset.action;

      const result = await chrome.storage.local.get('videos');
      const videos = result.videos || {};

      if (action === 'complete') {
        videos[key].completed = true;
      } else if (action === 'rewatch') {
        videos[key].completed = false;
      } else if (action === 'remove') {
        delete videos[key];
      }

      await chrome.storage.local.set({ videos });
      loadVideos();
    });
  });
}

// Setup tab switching
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active tab
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding content
      const targetId = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === targetId);
      });
    });
  });
}

// Setup clear all button
function setupClearAll() {
  document.getElementById('clear-all').addEventListener('click', async () => {
    if (confirm('Clear all watch history? This cannot be undone.')) {
      await chrome.storage.local.set({ videos: {} });
      loadVideos();
    }
  });
}
