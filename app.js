const CONFIG = window.WORSHIP_HUB_CONFIG || {};
const SERVICES = {
  traditional: {
    label: '9:30 Traditional Worship',
    fallback: 'https://versaillesumc.churchcenter.com/services/service_types/1525584/plans/after/today/public'
  },
  contemporary: {
    label: '10:30 Contemporary Worship',
    fallback: 'https://versaillesumc.churchcenter.com/services/service_types/1061239/plans/after/today/public'
  }
};

let activeService = 'traditional';
let hubData = null;

const $ = (selector) => document.querySelector(selector);
const dashboard = $('#dashboard');
const statusMessage = $('#status-message');

function escapeHtml(value = '') {
  const element = document.createElement('div');
  element.textContent = String(value);
  return element.innerHTML;
}

function formatDate(value) {
  if (!value) return 'Upcoming Sunday';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(value));
}

function setBusy(message) {
  statusMessage.hidden = false;
  statusMessage.className = 'status-message';
  statusMessage.textContent = message;
}

function setError(message) {
  statusMessage.hidden = false;
  statusMessage.className = 'status-message error';
  statusMessage.innerHTML = `${escapeHtml(message)} <a href="${SERVICES[activeService].fallback}">Open the plan in Church Center</a>.`;
}

async function apiGet(action, params = {}) {
  if (!CONFIG.apiUrl) throw new Error('The data connection has not been added yet.');
  const url = new URL(CONFIG.apiUrl);
  url.search = new URLSearchParams({ action, ...params });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error('The Worship Hub could not reach its data service.');
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'The data service returned an error.');
  return payload;
}

async function apiPost(action, fields) {
  if (!CONFIG.apiUrl) throw new Error('The data connection has not been added yet.');
  const body = new URLSearchParams({ action, ...fields });
  const response = await fetch(CONFIG.apiUrl, { method: 'POST', body, redirect: 'follow' });
  if (!response.ok) throw new Error('Your response could not be saved.');
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Your response could not be saved.');
  return payload;
}

function renderPlan(data) {
  $('#service-label').textContent = data.service?.name || SERVICES[activeService].label;
  $('#plan-title').textContent = formatDate(data.plan?.date);
  $('#plan-subtitle').textContent = data.plan?.title || 'The upcoming order of worship and team response page.';
  $('#pco-fallback').href = data.plan?.publicUrl || SERVICES[activeService].fallback;

  const items = data.items || [];
  $('#plan-items').innerHTML = items.length
    ? items.map((item) => `<li><div><strong>${escapeHtml(item.title || 'Untitled item')}</strong>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}</div>${item.people?.length ? `<span class="item-people">${item.people.map(escapeHtml).join(', ')}</span>` : ''}</li>`).join('')
    : '<li class="empty-row">No plan items have been published yet.</li>';
}

function populatePeople(choir) {
  const options = (choir || []).map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
  $('#choir-person').innerHTML = '<option value="">Select your name…</option>' + options;
  $('#call-person').innerHTML = '<option value="">Select your name…</option>' + options;
}

function renderAttendance(data) {
  const choir = data.choir || [];
  const responses = new Map((data.attendance || []).map((entry) => [String(entry.personId), entry.response]));
  const present = choir.filter((person) => responses.get(String(person.id)) === 'present');
  const absent = choir.filter((person) => responses.get(String(person.id)) === 'absent');
  const pending = choir.filter((person) => !responses.has(String(person.id)));

  $('#confirmed-count').textContent = present.length;
  $('#present-count').textContent = present.length;
  $('#absent-count').textContent = absent.length;
  $('#pending-count').textContent = pending.length;
  $('#roster-list').innerHTML = choir.map((person) => {
    const response = responses.get(String(person.id)) || 'pending';
    const label = response === 'present' ? 'Present' : response === 'absent' ? 'Absent' : 'No response';
    return `<div><span>${escapeHtml(person.displayName || person.name)}</span><span class="response-status ${response}">${label}</span></div>`;
  }).join('') || '<p>No choir members were returned by the Choir list.</p>';
}

function renderCallToWorship(assignment) {
  const filled = Boolean(assignment?.personName);
  $('#call-filled').hidden = !filled;
  $('#call-form').hidden = filled;
  $('#call-name').textContent = assignment?.personName || '';
}

function renderServing(people) {
  $('#serving-list').innerHTML = (people || []).map((person) => {
    const status = person.status === 'C' || person.status === 'confirmed' ? 'Confirmed' : person.status === 'D' || person.status === 'declined' ? 'Declined' : 'Awaiting response';
    const statusClass = status === 'Confirmed' ? 'present' : status === 'Declined' ? 'absent' : 'pending';
    return `<div><div><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.position || person.team || 'Worship volunteer')}</span></div><span class="response-status ${statusClass}">${status}</span></div>`;
  }).join('') || '<p>No volunteers have been scheduled in Planning Center yet.</p>';
}

function renderHub(data) {
  hubData = data;
  renderPlan(data);
  populatePeople(data.choir);
  renderAttendance(data);
  renderCallToWorship(data.callToWorship);
  renderServing(data.serving);
  $('#attendance-section').hidden = activeService !== 'traditional';
  $('#call-section').hidden = activeService !== 'traditional';
  dashboard.hidden = false;
  statusMessage.hidden = true;
}

function setFormBusy(form, busy, savingButton) {
  form.querySelectorAll('button, select').forEach((control) => { control.disabled = busy; });
  if (!savingButton) return;
  if (busy) {
    savingButton.dataset.originalText = savingButton.textContent;
    savingButton.textContent = 'Saving…';
  } else {
    savingButton.textContent = savingButton.dataset.originalText || savingButton.textContent;
  }
}

function showAttendanceConfirmation(name, response) {
  const banner = $('#attendance-confirmation');
  const message = response === 'present'
    ? `${name}, you are confirmed for this Sunday. Thank you!`
    : `${name}, your absence has been recorded. Thank you for letting us know.`;
  banner.innerHTML = `<span aria-hidden="true">✓</span><strong>${escapeHtml(message)}</strong>`;
  banner.className = `confirmation-banner ${response}`;
  banner.hidden = false;
  clearTimeout(showAttendanceConfirmation.timer);
  showAttendanceConfirmation.timer = setTimeout(() => { banner.hidden = true; }, 9000);
}

async function loadHub() {
  setBusy('Loading the upcoming worship plan…');
  dashboard.hidden = true;
  try {
    const data = await apiGet('hub', { service: activeService, _: Date.now() });
    renderHub(data);
  } catch (error) {
    setError(error.message);
    $('#plan-title').textContent = SERVICES[activeService].label;
    $('#plan-subtitle').textContent = 'The customized display will appear here when the secure data connection is deployed.';
  }
}

document.querySelectorAll('.service-tab').forEach((button) => {
  button.addEventListener('click', () => {
    activeService = button.dataset.service;
    document.querySelectorAll('.service-tab').forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-pressed', String(selected));
    });
    loadHub();
  });
});

$('#refresh-button').addEventListener('click', loadHub);

$('#attendance-form').addEventListener('click', (event) => {
  if (event.target.matches('button[name="response"]')) {
    $('#attendance-form').dataset.response = event.target.value;
  }
});

$('#attendance-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const savingButton = event.submitter;
  const personId = $('#choir-person').value;
  const personName = $('#choir-person').selectedOptions[0]?.textContent || 'Your';
  const response = savingButton?.value || form.dataset.response;
  if (!personId || !response || !hubData?.plan?.id) return;
  setFormBusy(form, true, savingButton);
  setBusy('Saving your attendance response…');
  try {
    await apiPost('attendance', { planId: hubData.plan.id, personId, response });
    await loadHub();
    showAttendanceConfirmation(personName, response);
  } catch (error) {
    setError(error.message);
  } finally {
    setFormBusy(form, false, savingButton);
  }
});

$('#call-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const personId = $('#call-person').value;
  if (!personId || !hubData?.plan?.id) return;
  setBusy('Saving the Call to Worship volunteer…');
  try {
    await apiPost('callToWorship', { planId: hubData.plan.id, personId });
    await loadHub();
  } catch (error) {
    setError(error.message);
  }
});

const installButton = $('#install-button');
const installDialog = $('#install-dialog');
const instructions = $('#install-instructions');
let deferredInstallPrompt = null;

function showInstructions() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) instructions.innerHTML = '<p>The Worship Hub is already saved to this device.</p>';
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) instructions.innerHTML = '<ol><li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button.</li><li>Tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>';
  else if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt = null; return; }
  else instructions.innerHTML = '<ol><li>Open your browser menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</li><li>Follow the message on your screen.</li></ol>';
  installDialog.showModal();
}

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; });
installButton.addEventListener('click', showInstructions);
$('#close-dialog').addEventListener('click', () => installDialog.close());
installDialog.addEventListener('click', (event) => { if (event.target === installDialog) installDialog.close(); });

function updateConnectionStatus() { $('#offline-message').hidden = navigator.onLine; }
window.addEventListener('online', () => { updateConnectionStatus(); loadHub(); });
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();
loadHub();

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
