const installButton = document.querySelector('#install-button');
const installDialog = document.querySelector('#install-dialog');
const instructions = document.querySelector('#install-instructions');
const closeDialog = document.querySelector('#close-dialog');
const offlineMessage = document.querySelector('#offline-message');

let deferredInstallPrompt = null;

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function showInstructions() {
  if (isStandalone()) {
    instructions.innerHTML = '<p>The Worship Hub is already saved to this device. Open it from your Home Screen whenever you need it.</p>';
  } else if (isIOS()) {
    instructions.innerHTML = `
      <ol>
        <li>Open this page in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button at the bottom of the screen.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>.</li>
      </ol>`;
  } else if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
      deferredInstallPrompt = null;
    });
    return;
  } else {
    instructions.innerHTML = `
      <ol>
        <li>Open your browser menu.</li>
        <li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</li>
        <li>Follow the message on your screen.</li>
      </ol>`;
  }

  installDialog.showModal();
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

installButton.addEventListener('click', showInstructions);
closeDialog.addEventListener('click', () => installDialog.close());
installDialog.addEventListener('click', (event) => {
  if (event.target === installDialog) installDialog.close();
});

function updateConnectionStatus() {
  offlineMessage.hidden = navigator.onLine;
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}
