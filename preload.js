const { ipcRenderer } = require('electron');

let speedMultiplier = 1;
let currentQuality = 'high';
let speedInterval = null;

function applySpeedToPage(speed) {
  try {
    speedMultiplier = speed;
    
    if (speed === 1) {
      console.log('Speed reset to 1x');
      return;
    }
    
    const speedScript = `
      (function() {
        try {
          window.__speedMultiplier = ${speed};
          
          if (!window.__originalDateNow) {
            window.__originalDateNow = Date.now;
            window.__originalPerfNow = performance.now.bind(performance);
            window.__originalSetTimeout = setTimeout.bind(window);
            window.__originalSetInterval = setInterval.bind(window);
            window.__originalRequestAnimationFrame = requestAnimationFrame.bind(window);
            
            Date.now = function() {
              return window.__originalDateNow() * window.__speedMultiplier;
            };
            
            performance.now = function() {
              return window.__originalPerfNow() * window.__speedMultiplier;
            };
            
            window.setTimeout = function(callback, delay) {
              const adjustedDelay = delay / window.__speedMultiplier;
              return window.__originalSetTimeout(callback, adjustedDelay);
            };
            
            window.setInterval = function(callback, delay) {
              const adjustedDelay = delay / window.__speedMultiplier;
              return window.__originalSetInterval(callback, adjustedDelay);
            };
            
            window.requestAnimationFrame = function(callback) {
              return window.__originalRequestAnimationFrame(function(timestamp) {
                callback(timestamp * window.__speedMultiplier);
              });
            };
            
            console.log('Speed control initialized, multiplier: ' + window.__speedMultiplier);
          } else {
            window.__speedMultiplier = ${speed};
            console.log('Speed multiplier updated: ' + window.__speedMultiplier);
          }
        } catch (e) {
          console.error('Speed control error:', e);
        }
      })();
    `;
    
    window.eval(speedScript);
    console.log('Speed applied to page: ' + speed + 'x');
  } catch (e) {
    console.error('applySpeedToPage error:', e);
  }
}

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

ipcRenderer.on('set-speed', (event, speed) => {
  console.log('Received set-speed message:', speed + 'x');
  applySpeedToPage(speed);
});

ipcRenderer.on('set-quality', (event, quality) => {
  console.log('Received set-quality message:', quality);
  applyQualityToPage(quality);
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('Preload script ready');
  ipcRenderer.send('log-message', 'Preload script loaded');
});

window.addEventListener('load', () => {
  console.log('Page loaded, initializing speed control');
  setTimeout(() => {
    applySpeedToPage(speedMultiplier);
    applyQualityToPage(currentQuality);
  }, 1000);
});
