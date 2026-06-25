const { ipcRenderer } = require('electron');

let currentQuality = 'high';
let qualityApplied = false;

function applyQualityToPage(quality) {
  if (qualityApplied && quality === currentQuality) return;
  
  try {
    currentQuality = quality;
    qualityApplied = true;
    
    window.__gameQuality = quality;
    
    if (window.flashvars) {
      window.flashvars.quality = quality;
    }
  } catch (e) {}
}

ipcRenderer.on('set-quality', (event, quality) => {
  applyQualityToPage(quality);
});

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('preload-ready');
  applyQualityToPage(currentQuality);
});