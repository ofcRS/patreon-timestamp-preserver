// Video Timestamp Preserver - Content Script
// Supports: Patreon, Google Drive

(function() {
  'use strict';

  const SAVE_INTERVAL = 15000; // Save every 15 seconds
  const TOAST_DURATION = 3000;
  const GRACE_PERIOD = 45; // Seconds of sustained playback before accepting a backward seek
  const NEAR_PEAK_BUFFER = 5; // Seconds of tolerance for "near peak"

  const DEBUG = true; // Set to false to silence debug logs
  function log(...args) { if (DEBUG) console.log('PTS:', ...args); }
  function warn(...args) { console.warn('PTS:', ...args); }

  let currentVideo = null;  // For Patreon (actual video element)
  let trackedVideoKey = null; // URL key of the video we're already tracking
  let gdriveTrackingActive = false;  // For Google Drive (DOM-based tracking)
  let saveIntervalId = null;
  let hasRestoredPosition = false;
  let findVideosPending = false; // Debounce flag for MutationObserver
  let findVideosCallCount = 0; // Debug counter
  let lastUrl = window.location.href; // SPA navigation detection
  let pauseHandler = null;  // Stored listener refs for cleanup
  let endedHandler = null;
  let observer = null; // MutationObserver ref for cleanup
  let navigationIntervalId = null; // SPA navigation check interval
  let destroyed = false; // Set when extension context is invalidated

  // Peak tracking state
  let peakTimestamp = 0;
  let sustainedPlaybackStart = null;
  let sustainedPlaybackTime = 0;
  let lastSaveTime = null;

  // Detect which site we're on
  function getSiteType() {
    const hostname = window.location.hostname;
    if (hostname.includes('patreon.com')) return 'patreon';
    if (hostname.includes('drive.google.com')) return 'gdrive';
    return 'unknown';
  }

  // Normalize URL to use as storage key (remove unnecessary params)
  function getVideoKey() {
    const url = new URL(window.location.href);
    // Keep only the pathname for consistent matching
    return url.origin + url.pathname;
  }

  // Parse time string like "43:52" or "8:09:35" to seconds
  function parseTimeString(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  // Get Google Drive video time info from DOM
  function getGDriveTimeInfo() {
    // Primary: try to get from seek slider which has detailed aria-valuetext
    const seekSlider = document.querySelector('input[aria-label="Seek slider"]');
    if (seekSlider) {
      const valueText = seekSlider.getAttribute('aria-valuetext');
      // Format with hours: "43 minutes 52 seconds of 8 hours 9 minutes 35 seconds"
      // Format without hours: "5 minutes 30 seconds of 10 minutes 0 seconds"

      if (valueText) {
        // Parse current time
        let currentTime = 0;
        let duration = 0;

        // Split by " of " to get current and total
        const parts = valueText.split(' of ');
        if (parts.length === 2) {
          currentTime = parseAriaTime(parts[0]);
          duration = parseAriaTime(parts[1]);

          if (duration > 0) {
            return { currentTime, duration };
          }
        }
      }

      // Also try using the slider's value and max attributes
      const value = parseInt(seekSlider.value);
      const max = parseInt(seekSlider.max);
      if (max > 0) {
        // Values are in milliseconds
        return {
          currentTime: value / 1000,
          duration: max / 1000
        };
      }
    }

    // Fallback: try to get from the time display elements
    const currentTimeEl = document.querySelector('[jsname="biJjHb"]');
    const durationEl = document.querySelector('[jsname="Mjm4te"]');

    if (currentTimeEl && durationEl) {
      const currentText = currentTimeEl.textContent.trim();
      const durationText = durationEl.textContent.trim();
      if (currentText && durationText) {
        return {
          currentTime: parseTimeString(currentText),
          duration: parseTimeString(durationText)
        };
      }
    }

    return null;
  }

  // Parse aria-valuetext time like "43 minutes 52 seconds" or "8 hours 9 minutes 35 seconds"
  function parseAriaTime(text) {
    let total = 0;

    const hoursMatch = text.match(/(\d+)\s*hours?/i);
    const minutesMatch = text.match(/(\d+)\s*minutes?/i);
    const secondsMatch = text.match(/(\d+)\s*seconds?/i);

    if (hoursMatch) total += parseInt(hoursMatch[1]) * 3600;
    if (minutesMatch) total += parseInt(minutesMatch[1]) * 60;
    if (secondsMatch) total += parseInt(secondsMatch[1]);

    return total;
  }

  // Check if Google Drive video is playing
  function isGDrivePlaying() {
    const playButton = document.querySelector('[jsname="IGlMSc"]');
    if (playButton) {
      return playButton.getAttribute('aria-pressed') === 'true';
    }
    return false;
  }

  // Extract video title from page
  function getVideoTitle() {
    const site = getSiteType();

    if (site === 'gdrive') {
      // Google Drive file title selectors
      const selectors = [
        '[data-tooltip="Show file details"]',   // Toolbar title button
        'div[data-id] div[role="heading"]',     // File name heading
        '[aria-label*=".mp4"]',                 // File name in aria-label
        '[aria-label*=".mov"]',
        '[aria-label*=".webm"]',
        '.a-b-r-La-ib-ha'                       // Legacy selector
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.getAttribute('aria-label') || el.textContent.trim();
          if (text) {
            return text.substring(0, 150);
          }
        }
      }

      // Fallback: extract filename from URL or title
      const pathMatch = window.location.pathname.match(/\/file\/d\/([^/]+)/);
      if (pathMatch) {
        // Try to get from document title (usually "filename - Google Drive")
        const title = document.title.replace(' - Google Drive', '').trim();
        if (title && title !== 'Google Drive') {
          return title;
        }
        return `Google Drive Video (${pathMatch[1].substring(0, 8)}...)`;
      }
    }

    // Patreon selectors
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

  // Extract creator/owner name from page
  function getCreatorName() {
    const site = getSiteType();

    if (site === 'gdrive') {
      // Google Drive doesn't easily expose owner info on the video page
      return 'Google Drive';
    }

    // Patreon selectors
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
    const site = getSiteType();

    if (site === 'gdrive') {
      // Google Drive doesn't show date on video preview page
      return null;
    }

    // Patreon selectors
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

  // Tear down everything when extension context is invalidated
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopTracking();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (navigationIntervalId) {
      clearInterval(navigationIntervalId);
      navigationIntervalId = null;
    }
    currentVideo = null;
    trackedVideoKey = null;
    gdriveTrackingActive = false;
    warn('Extension context invalidated — cleaned up all timers/observers');
  }

  // Check if extension context is still valid, destroy if not
  function isContextValid() {
    try {
      void chrome.runtime.id;
      return true;
    } catch (e) {
      destroy();
      return false;
    }
  }

  // Reset peak tracking state
  function resetPeakState() {
    peakTimestamp = 0;
    sustainedPlaybackStart = null;
    sustainedPlaybackTime = 0;
    lastSaveTime = null;
  }

  // Update peak tracking based on current playback position
  function updatePeakTracking(currentTime, isPlaying) {
    const now = Date.now();

    if (currentTime >= peakTimestamp - NEAR_PEAK_BUFFER) {
      // Forward progress or near peak — update peak and reset grace timer
      peakTimestamp = Math.max(peakTimestamp, currentTime);
      sustainedPlaybackTime = 0;
      sustainedPlaybackStart = isPlaying ? now : null;
    } else {
      // Below peak — accumulate sustained playback time
      if (isPlaying) {
        if (sustainedPlaybackStart !== null && lastSaveTime !== null) {
          const elapsed = (now - lastSaveTime) / 1000;
          // Cap at 2x save interval to ignore laptop sleep gaps
          sustainedPlaybackTime += Math.min(elapsed, (SAVE_INTERVAL / 1000) * 2);
        }
        sustainedPlaybackStart = now;
      } else {
        sustainedPlaybackStart = null;
      }

      if (sustainedPlaybackTime >= GRACE_PERIOD) {
        // User has been watching at the lower position long enough — accept it
        peakTimestamp = currentTime;
        sustainedPlaybackTime = 0;
        sustainedPlaybackStart = isPlaying ? now : null;
        log('Grace period elapsed, accepted new peak at', formatTime(currentTime));
      }
    }

    lastSaveTime = now;
  }

  // Save current video state
  async function saveVideoState(force = false) {
    if (destroyed || !isContextValid()) return;

    const site = getSiteType();
    let timestamp, duration;

    let isPlaying;

    if (site === 'gdrive') {
      const timeInfo = getGDriveTimeInfo();
      if (!timeInfo || timeInfo.duration === 0) return;
      timestamp = timeInfo.currentTime;
      duration = timeInfo.duration;
      isPlaying = isGDrivePlaying();
      if (!force && !isPlaying) return;
    } else {
      // Patreon - use video element
      if (!currentVideo) return;
      isPlaying = !currentVideo.paused;
      if (!force && !isPlaying) return;
      timestamp = currentVideo.currentTime;
      duration = currentVideo.duration || 0;
      if (duration === 0 || isNaN(duration)) return;
    }

    // Update peak tracking
    updatePeakTracking(timestamp, isPlaying);

    const videoKey = getVideoKey();
    const progress = (peakTimestamp / duration) * 100;

    const videoData = {
      title: getVideoTitle(),
      creator: getCreatorName(),
      postDate: getPostDate(),
      url: window.location.href,
      timestamp: timestamp,
      peakTimestamp: peakTimestamp,
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
      log('Saved -', formatTime(timestamp), '/', formatTime(duration), '(peak:', formatTime(peakTimestamp) + ')');
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        destroy();
      } else {
        console.error('PTS: Error saving video state:', e);
      }
    }
  }

  // Restore video position (Patreon only - video element)
  async function restoreVideoPosition() {
    if (destroyed || !currentVideo || hasRestoredPosition) return;

    const videoKey = getVideoKey();

    try {
      const result = await chrome.storage.local.get('videos');
      const videos = result.videos || {};
      const savedData = videos[videoKey];

      const restorePoint = savedData ? (savedData.peakTimestamp || savedData.timestamp) : 0;

      if (savedData && restorePoint > 10) {
        // Initialize peak tracking state from saved data
        peakTimestamp = restorePoint;
        sustainedPlaybackTime = 0;
        sustainedPlaybackStart = null;
        lastSaveTime = null;

        // Wait for video to be ready
        if (currentVideo.readyState >= 2) {
          currentVideo.currentTime = restorePoint;
          hasRestoredPosition = true;
          showToast(`Resumed at ${formatTime(restorePoint)}`);
        } else {
          currentVideo.addEventListener('loadeddata', () => {
            if (!hasRestoredPosition) {
              currentVideo.currentTime = restorePoint;
              hasRestoredPosition = true;
              showToast(`Resumed at ${formatTime(restorePoint)}`);
            }
          }, { once: true });
        }
      }
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        destroy();
      } else {
        console.error('PTS: Error restoring video position:', e);
      }
    }
  }

  // Show saved position notification for Google Drive (can't auto-seek iframe)
  async function showGDriveSavedPosition() {
    if (destroyed || hasRestoredPosition) return;

    const videoKey = getVideoKey();

    try {
      const result = await chrome.storage.local.get('videos');
      const videos = result.videos || {};
      const savedData = videos[videoKey];

      const restorePoint = savedData ? (savedData.peakTimestamp || savedData.timestamp) : 0;

      if (savedData && restorePoint > 10) {
        // Initialize peak tracking state from saved data
        peakTimestamp = restorePoint;
        sustainedPlaybackTime = 0;
        sustainedPlaybackStart = null;
        lastSaveTime = null;

        hasRestoredPosition = true;
        showToast(`Last position: ${formatTime(restorePoint)} - seek manually to resume`);
      }
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        destroy();
      } else {
        console.error('PTS: Error getting saved position:', e);
      }
    }
  }

  // Stop tracking the current video and clean up listeners
  function stopTracking() {
    if (saveIntervalId) {
      clearInterval(saveIntervalId);
      saveIntervalId = null;
    }
    if (currentVideo) {
      if (pauseHandler) currentVideo.removeEventListener('pause', pauseHandler);
      if (endedHandler) currentVideo.removeEventListener('ended', endedHandler);
    }
    pauseHandler = null;
    endedHandler = null;
  }

  // Start tracking a video element (Patreon)
  function startTracking(video) {
    if (currentVideo === video) return;

    const videoKey = getVideoKey();
    const isSwap = (trackedVideoKey === videoKey);

    // Clean up previous video's listeners/interval
    stopTracking();

    currentVideo = video;
    trackedVideoKey = videoKey;

    if (isSwap) {
      // Same page, React just replaced the <video> element — keep state, just reattach
      log('Video element swapped (React re-render), reattaching. hasRestored:', hasRestoredPosition, 'peak:', formatTime(peakTimestamp));
    } else {
      // New video page — full initialization
      hasRestoredPosition = false;
      resetPeakState();
      restoreVideoPosition();
      log('Started tracking new video, key:', videoKey);
    }

    // Always restart interval and listeners (they were cleared by stopTracking)
    saveIntervalId = setInterval(saveVideoState, SAVE_INTERVAL);
    pauseHandler = () => saveVideoState(true);
    endedHandler = () => saveVideoState(true);
    video.addEventListener('pause', pauseHandler);
    video.addEventListener('ended', endedHandler);
  }

  // Start tracking Google Drive video (DOM-based)
  function startGDriveTracking() {
    if (gdriveTrackingActive) return;

    // Check if video player is present
    const playerControls = document.querySelector('[jsname="mzm68b"]');
    if (!playerControls) return;

    gdriveTrackingActive = true;
    hasRestoredPosition = false;
    resetPeakState();

    // Show saved position if available
    showGDriveSavedPosition();

    // Start periodic saving
    if (saveIntervalId) {
      clearInterval(saveIntervalId);
    }
    saveIntervalId = setInterval(saveVideoState, SAVE_INTERVAL);

    log('Started tracking Google Drive video');
  }

  // Find and track video elements
  function findVideos() {
    findVideosCallCount++;
    const site = getSiteType();

    if (site === 'gdrive') {
      startGDriveTracking();
      return;
    }

    // Already tracking a video that's still in the DOM — nothing to do
    if (currentVideo && document.contains(currentVideo)) {
      return;
    }

    if (currentVideo && !document.contains(currentVideo)) {
      log('Tracked video element was removed from DOM (call #' + findVideosCallCount + ')');
    }

    // Patreon - look for video elements
    const videos = document.querySelectorAll('video');
    log('findVideos call #' + findVideosCallCount + ': found', videos.length, 'video element(s)');

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width < 200) {
        log('  Skipping video, too small:', rect.width + 'x' + rect.height);
        continue;
      }

      // Track this video
      startTracking(video);
      return; // Only track one video at a time
    }

    log('  No suitable video found');
  }

  // Debounced version of findVideos — coalesces rapid-fire MutationObserver callbacks
  function scheduleFindVideos() {
    if (destroyed || findVideosPending) return;
    findVideosPending = true;
    requestAnimationFrame(() => {
      findVideosPending = false;
      if (!destroyed) findVideos();
    });
  }

  // Check for SPA navigation (URL changed without full page reload)
  function checkNavigation() {
    if (destroyed) return;
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      log('SPA navigation detected:', lastUrl, '->', currentUrl);
      lastUrl = currentUrl;
      // URL changed — reset tracking state for new page
      stopTracking();
      currentVideo = null;
      trackedVideoKey = null;
      gdriveTrackingActive = false;
      hasRestoredPosition = false;
      resetPeakState();
      findVideos();
    }
  }

  // Initialize
  function init() {
    const site = getSiteType();

    // Initial check for videos
    findVideos();

    // Watch for dynamically added videos — debounced to avoid hammering on React re-renders
    observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) {
        scheduleFindVideos();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Save before page unload
    window.addEventListener('beforeunload', () => saveVideoState(true));

    // Check for SPA navigation periodically (much cheaper than findVideos — just compares URLs)
    navigationIntervalId = setInterval(checkNavigation, 2000);

    log('Initialized on', site, '| URL:', window.location.href);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
