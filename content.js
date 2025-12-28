// Patreon Timestamp Preserver - Content Script

(function() {
  'use strict';

  const SAVE_INTERVAL = 15000; // Save every 15 seconds
  const TOAST_DURATION = 3000;

  let currentVideo = null;
  let saveIntervalId = null;
  let hasRestoredPosition = false;

  // Normalize URL to use as storage key (remove unnecessary params)
  function getVideoKey() {
    const url = new URL(window.location.href);
    // Keep only the pathname for consistent matching
    return url.origin + url.pathname;
  }

  // Extract video title from page
  function getVideoTitle() {
    // Try different selectors for Patreon post titles
    const selectors = [
      '[data-is-key-element="true"]',           // Primary - Patreon's key element
      '[elementtiming*="Post Title"]',          // Fallback - elementtiming attribute
      '[data-tag="post-title"]',
      'h1[data-tag="post-title"]',
      'article h1',
      '[data-tag="post-card"] h2',
      'h1'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim().substring(0, 150);
      }
    }

    return document.title.replace(' | Patreon', '').trim() || 'Untitled Video';
  }

  // Extract creator name from page
  function getCreatorName() {
    const selectors = [
      '[data-tag="creator-name"]',
      'a[href*="/c/"] span',
      '[data-tag="creator-info"] a',
      'a[data-tag="creator-page-link"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim().substring(0, 50);
      }
    }
    return null;
  }

  // Extract post date from page
  function getPostDate() {
    const selectors = [
      'time[datetime]',
      '[data-tag="post-published-at"]',
      'time'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        // Try datetime attribute first
        if (el.getAttribute('datetime')) {
          return el.getAttribute('datetime');
        }
        if (el.textContent.trim()) {
          return el.textContent.trim();
        }
      }
    }
    return null;
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

  // Show toast notification
  function showToast(message) {
    // Remove existing toast if any
    const existingToast = document.getElementById('pts-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'pts-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: pts-fade-in 0.3s ease;
    `;

    // Add animation keyframes
    if (!document.getElementById('pts-styles')) {
      const style = document.createElement('style');
      style.id = 'pts-styles';
      style.textContent = `
        @keyframes pts-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pts-fade-out {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(10px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-dismiss
    setTimeout(() => {
      toast.style.animation = 'pts-fade-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, TOAST_DURATION);
  }

  // Save current video state
  async function saveVideoState() {
    if (!currentVideo || currentVideo.paused) return;

    const videoKey = getVideoKey();
    const timestamp = currentVideo.currentTime;
    const duration = currentVideo.duration || 0;

    if (duration === 0 || isNaN(duration)) return;

    const progress = (timestamp / duration) * 100;

    const videoData = {
      title: getVideoTitle(),
      creator: getCreatorName(),
      postDate: getPostDate(),
      url: window.location.href,
      timestamp: timestamp,
      duration: duration,
      progress: Math.round(progress * 10) / 10,
      lastWatched: Date.now(),
      completed: progress >= 95 // Auto-mark as completed if 95%+ watched
    };

    try {
      const result = await chrome.storage.local.get('videos');
      const videos = result.videos || {};
      videos[videoKey] = videoData;
      await chrome.storage.local.set({ videos });
    } catch (e) {
      console.error('PTS: Error saving video state:', e);
    }
  }

  // Restore video position
  async function restoreVideoPosition() {
    if (!currentVideo || hasRestoredPosition) return;

    const videoKey = getVideoKey();

    try {
      const result = await chrome.storage.local.get('videos');
      const videos = result.videos || {};
      const savedData = videos[videoKey];

      if (savedData && savedData.timestamp > 10) {
        // Wait for video to be ready
        if (currentVideo.readyState >= 2) {
          currentVideo.currentTime = savedData.timestamp;
          hasRestoredPosition = true;
          showToast(`Resumed at ${formatTime(savedData.timestamp)}`);
        } else {
          currentVideo.addEventListener('loadeddata', () => {
            if (!hasRestoredPosition) {
              currentVideo.currentTime = savedData.timestamp;
              hasRestoredPosition = true;
              showToast(`Resumed at ${formatTime(savedData.timestamp)}`);
            }
          }, { once: true });
        }
      }
    } catch (e) {
      console.error('PTS: Error restoring video position:', e);
    }
  }

  // Start tracking a video element
  function startTracking(video) {
    if (currentVideo === video) return;

    // Stop tracking previous video
    if (saveIntervalId) {
      clearInterval(saveIntervalId);
    }

    currentVideo = video;
    hasRestoredPosition = false;

    // Restore saved position
    restoreVideoPosition();

    // Start periodic saving
    saveIntervalId = setInterval(saveVideoState, SAVE_INTERVAL);

    // Also save on pause and before unload
    video.addEventListener('pause', saveVideoState);
    video.addEventListener('ended', () => {
      saveVideoState();
    });

    console.log('PTS: Started tracking video');
  }

  // Find and track video elements
  function findVideos() {
    const videos = document.querySelectorAll('video');

    for (const video of videos) {
      // Skip tiny videos (likely thumbnails)
      if (video.offsetWidth < 200) continue;

      // Track this video
      startTracking(video);
      return; // Only track one video at a time
    }
  }

  // Initialize
  function init() {
    // Initial check for videos
    findVideos();

    // Watch for dynamically added videos
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          findVideos();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Save before page unload
    window.addEventListener('beforeunload', saveVideoState);

    // Re-check periodically for SPA navigation
    setInterval(findVideos, 2000);

    console.log('PTS: Patreon Timestamp Preserver initialized');
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
