const { ipcRenderer } = require('electron');

let speedMultiplier = 1;
let currentQuality = 'high';

function applyQualityToPage(quality) {
  try {
    currentQuality = quality;
    console.log('Applying quality setting: ' + quality);
    
    const qualityScript = `
      (function() {
        try {
          window.__gameQuality = '${quality}';
          
          if (window.flashvars) {
            window.flashvars.quality = '${quality}';
          }
          
          if (window.document && window.document.getElementsByTagName) {
            var embeds = window.document.getElementsByTagName('embed');
            for (var i = 0; i < embeds.length; i++) {
              embeds[i].setAttribute('quality', '${quality}');
            }
            
            var objects = window.document.getElementsByTagName('object');
            for (var i = 0; i < objects.length; i++) {
              var params = objects[i].getElementsByTagName('param');
              for (var j = 0; j < params.length; j++) {
                if (params[j].getAttribute('name') === 'quality') {
                  params[j].setAttribute('value', '${quality}');
                }
              }
            }
          }
          
          console.log('Quality setting applied: ' + '${quality}');
        } catch (e) {
          console.error('Quality control error:', e);
        }
      })();
    `;
    
    window.eval(qualityScript);
    console.log('Quality applied to page: ' + quality);
  } catch (e) {
    console.error('applyQualityToPage error:', e);
  }
}

ipcRenderer.on('set-quality', (event, quality) => {
  console.log('Received set-quality message:', quality);
  applyQualityToPage(quality);
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('Preload script ready');
  ipcRenderer.send('log-message', 'Preload script loaded');
});

window.addEventListener('load', () => {
  console.log('Page loaded');
  setTimeout(() => {
    applyQualityToPage(currentQuality);
  }, 1000);
});