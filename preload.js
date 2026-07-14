const { ipcRenderer } = require('electron');

let currentQuality = 'high';
let baseQuality = 'high';
let isActive = true;

function applyQualityToPage(quality) {
  if (quality === currentQuality) return;
  
  try {
    currentQuality = quality;
    window.__gameQuality = quality;
    
    if (window.flashvars) {
      window.flashvars.quality = quality;
    }
    
    if (window.navigator && window.navigator.plugins) {
      const flashPlugins = Array.from(window.navigator.plugins).filter(p => p.name.includes('Shockwave Flash'));
      if (flashPlugins.length > 0) {
        try {
          const embedElements = document.querySelectorAll('embed, object');
          embedElements.forEach(elem => {
            if (elem.getAttribute && elem.getAttribute('type') === 'application/x-shockwave-flash') {
              elem.setAttribute('quality', quality);
            }
          });
        } catch (e) {}
      }
    }
  } catch (e) {}
}

function setActiveState(active) {
  isActive = active;
  if (active) {
    applyQualityToPage(baseQuality);
  } else {
    applyQualityToPage('low');
  }
}

ipcRenderer.on('set-quality', (event, quality) => {
  baseQuality = quality;
  if (isActive) {
    applyQualityToPage(quality);
  }
});

ipcRenderer.on('set-active', (event, active) => {
  setActiveState(active);
});

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('preload-ready');
  applyQualityToPage(currentQuality);
});

window.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    setActiveState(false);
  } else {
    setActiveState(true);
  }
});