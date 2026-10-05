const CONFIG = window.WORSHIP_HUB_CONFIG || {};

const SERVICES = {
  traditional: {
    label: '9:30 Worship',
    fallback: 'https://versaillesumc.churchcenter.com/services/service_types/1525584/plans/after/today/public'
  },
  contemporary: {
    label: '10:30 Worship',
    fallback: 'https://versaillesumc.churchcenter.com/services/service_types/1061239/plans/after/today/public'
  }
};

let activeService = 'traditional';
let hubData = null;
let currentLoad = 0;
let callSchedule = null;
let callSaving = false;

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

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00`)
    : new Date(value);

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function formatCallDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value + 'T12:00:00'));
}

function setBusy(message) {
  statusMessage.hidden = false;
  statusMessage.className = 'status-message';
  statusMessage.textContent = message;
}

function setError(message) {
  statusMessage.hidden = false;
  statusMessage.className = 'status-message error';
  statusMessage.innerHTML =
    `${escapeHtml(message)} ` +
    `<a href="${SERVICES[activeService].fallback}">` +
    'Open the plan in Church Center</a>.';
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fetchWithTimeout(url, options = {}, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(action, params = {}, quiet = false) {
  if (!CONFIG.apiUrl) {
    throw new Error('The data connection has not been added yet.');
  }

  const url = new URL(CONFIG.apiUrl);
  url.search = new URLSearchParams({ action, ...params });

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        redirect: 'follow',
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(
          'The Worship Hub could not reach its data service.'
        );
      }

      const payload = await response.json();

      if (!payload.ok) {
        throw new Error(
          payload.error || 'The data service returned an error.'
        );
      }

      return payload;
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        if (!quiet) {
          setBusy(
            attempt === 1
              ? 'The worship plan is taking a little longer. Trying again…'
              : 'Still connecting. One more try…'
          );
        }

        await wait(attempt * 900);
      }
    }
  }

  throw lastError || new Error(
    'The Worship Hub could not load the plan.'
  );
}

async function apiPost(action, fields) {
  if (!CONFIG.apiUrl) {
    throw new Error('The data connection has not been added yet.');
  }

  const makeBody = () => new URLSearchParams({
    action,
    ...fields
  });

  let response = null;

  try {
    response = await fetchWithTimeout(CONFIG.apiUrl, {
      method: 'POST',
      body: makeBody(),
      redirect: 'follow'
    });
  } catch (error) {
    response = null;
  }

  if (response?.ok) {
    let payload = null;

    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (payload) {
      if (!payload.ok) {
        throw new Error(
          payload.error || 'Your response could not be saved.'
        );
      }

      return payload;
    }
  }

  // An unreadable redirect does not establish whether the save succeeded.
  // Repeating the same booking is safe; the backend checks date and person.
  try {
    await fetchWithTimeout(CONFIG.apiUrl, {
      method: 'POST',
      body: makeBody(),
      mode: 'no-cors',
      redirect: 'follow'
    });
  } catch (error) {
    // Call to Worship bookings are verified by reading the spreadsheet.
    if (action !== 'callToWorship') {
      throw error;
    }
  }

  return {
    ok: true,
    redirectFallback: true
  };
}

function renderPlan(data) {
  $('#service-label').textContent =
    data.service?.name || SERVICES[activeService].label;

  $('#plan-title').textContent = formatDate(data.plan?.date);

  $('#plan-subtitle').textContent =
    data.plan?.title ||
    'The upcoming order of worship and team response page.';

  $('#pco-fallback').href =
    data.plan?.publicUrl || SERVICES[activeService].fallback;

  const items = data.items || [];

  $('#plan-items').innerHTML = items.length
    ? items.map((item) => {
        const description = item.description
          ? `<p>${escapeHtml(item.description)}</p>`
          : '';

        const people = item.people?.length
          ? `<span class="item-people">${
              item.people.map(escapeHtml).join(', ')
            }</span>`
          : '';

        return (
          '<li><div>' +
          `<strong>${escapeHtml(item.title || 'Untitled item')}</strong>` +
          description +
          '</div>' +
          people +
          '</li>'
        );
      }).join('')
    : '<li class="empty-row">No plan items have been published yet.</li>';
}

function populatePeople(participants) {
  const options = (participants || []).map((person) => {
    return (
      `<option value="${escapeHtml(person.id)}">` +
      `${escapeHtml(person.name)}</option>`
    );
  }).join('');

  const selectedAttendance = $('#attendance-person').value;
  const selectedCall = $('#call-person').value;

  $('#attendance-person').innerHTML =
    '<option value="">Select your name…</option>' + options;

  $('#call-person').innerHTML =
    '<option value="">Select your name…</option>' + options;

  $('#attendance-person').value = selectedAttendance;
  $('#call-person').value = selectedCall;
}

function renderAttendance(data) {
  const participants = data.participants || data.choir || [];

  const responses = new Map(
    (data.attendance || []).map((entry) => [
      String(entry.personId),
      entry.response
    ])
  );

  const present = participants.filter((person) => {
    return responses.get(String(person.id)) === 'present';
  });

  const absent = participants.filter((person) => {
    return responses.get(String(person.id)) === 'absent';
  });

  const pending = participants.filter((person) => {
    return !responses.has(String(person.id));
  });

  $('#confirmed-count').textContent = present.length;
  $('#present-count').textContent = present.length;
  $('#absent-count').textContent = absent.length;
  $('#pending-count').textContent = pending.length;

  $('#attendance-group-label').textContent =
    data.participation?.groupLabel || 'Worship attendance';

  $('#attendance-title').textContent =
    data.participation?.question || 'Will you be here Sunday?';

  $('#roster-list').innerHTML = participants.map((person) => {
    const response = responses.get(String(person.id)) || 'pending';

    const label = response === 'present'
      ? 'Present'
      : response === 'absent'
        ? 'Absent'
        : 'No response';

    return (
      '<div>' +
      `<span>${escapeHtml(person.displayName || person.name)}</span>` +
      `<span class="response-status ${response}">${label}</span>` +
      '</div>'
    );
  }).join('') || '<p>No names were returned for this worship team.</p>';
}

function updateCallControls() {
  const datesAvailable = Boolean(callSchedule?.dates?.length);
  const hasName = Boolean($('#call-person').value);
  const hasDate = Boolean($('#call-date').value);
  const offline = !navigator.onLine;

  $('#call-person').disabled = callSaving || offline;

  $('#call-date').disabled =
    callSaving ||
    offline ||
    !hasName ||
    !datesAvailable;

  $('#call-submit').disabled =
    callSaving ||
    offline ||
    !hasName ||
    !hasDate ||
    !datesAvailable;
}

function renderCallDates(schedule) {
  callSchedule = schedule || null;

  const select = $('#call-date');
  const previousDate = select.value;
  const dates = schedule?.dates || [];

  select.innerHTML =
    '<option value="">Select a Sunday…</option>' +
    dates.map((date) => {
      return (
        '<option value="' + escapeHtml(date) + '">' +
        escapeHtml(formatCallDate(date)) +
        ' · 9:30 AM</option>'
      );
    }).join('');

  if (dates.includes(previousDate)) {
    select.value = previousDate;
  }

  $('#call-availability').textContent = !schedule
    ? 'Available Sundays could not be loaded. Tap the refresh button to try again.'
    : dates.length
      ? 'All dates are for 9:30 AM. Booked Sundays are removed from this list.'
      : 'All Sundays in the next six months are currently booked.';

  renderCallVolunteerList(schedule);
  updateCallControls();
}

function renderCallVolunteerList(schedule) {
  let section = $('#call-volunteer-schedule');

  if (!section) {
    section = document.createElement('section');
    section.id = 'call-volunteer-schedule';

    section.setAttribute(
      'aria-labelledby',
      'call-volunteer-schedule-title'
    );

    section.style.marginTop = '24px';
    $('#call-section').insertAdjacentElement('afterend', section);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const dateParts = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  const today =
    dateParts.year + '-' +
    dateParts.month + '-' +
    dateParts.day;

  const entries = [...(schedule?.bookings || [])];
  const current = hubData?.callToWorship;
  const currentDate = current?.date || hubData?.attendanceKey ||
    String(hubData?.plan?.date || '').slice(0, 10);

  // Older plan-based assignments may not yet appear in schedule.bookings.
  if (activeService === 'traditional' && current?.personName &&
      !entries.some((entry) => entry.date === currentDate &&
        String(entry.personId) === String(current.personId))) {
    entries.push({ ...current, date: currentDate });
  }

  const bookings = entries
    .filter((booking) => {
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(booking.date) &&
        booking.date >= today &&
        (booking.personName || booking.personId)
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const heading =
    '<h3 id="call-volunteer-schedule-title">' +
    'Call to Worship Volunteer Schedule</h3>' +
    '<p class="muted">' +
    'Check here anytime to see when you or another volunteer is scheduled. All dates are at 9:30 AM.' +
    '</p>';

  if (!schedule && !bookings.length) {
    section.innerHTML =
      heading +
      '<p>The volunteer schedule could not be loaded. ' +
      'Tap the refresh button to try again.</p>';
    return;
  }

  if (!bookings.length) {
    section.innerHTML =
      heading +
      '<p>No upcoming volunteers have signed up yet.</p>';
    return;
  }

  const cellStyle =
    'padding:12px 8px;' +
    'text-align:left;' +
    'vertical-align:top;' +
    'border-bottom:1px solid currentColor;' +
    'overflow-wrap:anywhere;';

  const roster = hubData?.participants || hubData?.choir || [];

  section.innerHTML =
    heading +
    (!schedule
      ? '<p>The full schedule could not be loaded. Only the current volunteer is shown. Tap refresh to try again.</p>'
      : '') +
    `<p><strong>${bookings.length} upcoming ${bookings.length === 1 ? 'booking' : 'bookings'}</strong></p>` +
    '<table aria-labelledby="call-volunteer-schedule-title" ' +
    'style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
    '<thead><tr>' +
    '<th scope="col" style="' + cellStyle + '">Sunday</th>' +
    '<th scope="col" style="' + cellStyle + '">Volunteer</th>' +
    '</tr></thead><tbody>' +
    bookings.map((booking) => {
      return (
        '<tr>' +
        '<td style="' + cellStyle + '">' +
        escapeHtml(formatCallDate(booking.date)) +
        '</td>' +
        '<td style="' + cellStyle + '">' +
        escapeHtml(
          booking.personName ||
          roster.find((person) =>
            String(person.id) === String(booking.personId)
          )?.name ||
          'Volunteer name unavailable'
        ) +
        '</td>' +
        '</tr>'
      );
    }).join('') +
    '</tbody></table>';
}

function renderCallToWorship(assignment) {
  $('#call-filled').hidden = !assignment?.personName;
  $('#call-name').textContent = assignment?.personName || '';

  // Future sign-ups remain available when this Sunday is already filled.
  $('#call-form').hidden = false;
}

function showCallMessage(message, success = false) {
  const banner = $('#call-confirmation');

  banner.className = success
    ? 'confirmation-banner present'
    : 'confirmation-banner';

  banner.textContent = message;
  banner.hidden = false;
}

async function refreshCallSchedule() {
  const schedule = await apiGet(
    'callSchedule',
    { _: Date.now() },
    true
  );

  renderCallDates(schedule);

  if (activeService === 'traditional' && hubData) {
    const date = hubData.attendanceKey ||
      String(hubData.plan?.date || '').slice(0, 10);

    const assignment = (schedule.bookings || []).find((entry) => {
      return entry.date === date;
    }) || null;

    hubData.callToWorship = assignment;
    hubData.callSchedule = schedule;

    renderCallToWorship(assignment);
  }

  return schedule;
}

async function verifyCallBooking(date, personId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) {
      await wait(1000);
    }

    const schedule = await refreshCallSchedule();

    const booking = (schedule.bookings || []).find((entry) => {
      return entry.date === date;
    });

    if (booking) {
      if (String(booking.personId) !== String(personId)) {
        throw new Error(
          'That Sunday has just been booked by someone else. ' +
          'Please choose another date.'
        );
      }

      return booking;
    }
  }

  throw new Error(
    'We could not confirm your booking yet. ' +
    'Please refresh before trying again.'
  );
}

function renderServing(people) {
  $('#serving-list').innerHTML = (people || []).map((person) => {
    const status =
      person.status === 'C' || person.status === 'confirmed'
        ? 'Confirmed'
        : person.status === 'D' || person.status === 'declined'
          ? 'Declined'
          : 'Awaiting response';

    const statusClass = status === 'Confirmed'
      ? 'present'
      : status === 'Declined'
        ? 'absent'
        : 'pending';

    return (
      '<div><div>' +
      `<strong>${escapeHtml(person.name)}</strong>` +
      `<span>${escapeHtml(
        person.position || person.team || 'Worship volunteer'
      )}</span>` +
      '</div>' +
      `<span class="response-status ${statusClass}">${status}</span>` +
      '</div>'
    );
  }).join('') ||
    '<p>No volunteers have been scheduled in Planning Center yet.</p>';
}

function renderHub(data) {
  hubData = data;

  renderPlan(data);
  populatePeople(data.participants || data.choir);
  renderAttendance(data);
  renderCallToWorship(data.callToWorship);
  renderCallDates(data.callSchedule);
  renderServing(data.serving);

  $('#attendance-section').hidden =
    !data.participation?.attendanceEnabled;

  $('#call-section').hidden =
    !data.participation?.callToWorshipEnabled;

  dashboard.hidden = false;
  statusMessage.hidden = true;
}

function setFormBusy(form, busy, savingButton) {
  form.querySelectorAll('button, select').forEach((control) => {
    control.disabled = busy;
  });

  if (!savingButton) return;

  if (busy) {
    savingButton.dataset.originalText = savingButton.textContent;
    savingButton.textContent = 'Saving…';
  } else {
    savingButton.textContent =
      savingButton.dataset.originalText || savingButton.textContent;
  }
}

function showAttendanceConfirmation(name, response) {
  const banner = $('#attendance-confirmation');

  const message = response === 'present'
    ? `${name}, you are confirmed for this Sunday. Thank you!`
    : `${name}, your absence has been recorded. Thank you for letting us know.`;

  banner.innerHTML =
    '<span aria-hidden="true">✓</span>' +
    `<strong>${escapeHtml(message)}</strong>`;

  banner.className = `confirmation-banner ${response}`;
  banner.hidden = false;

  clearTimeout(showAttendanceConfirmation.timer);

  showAttendanceConfirmation.timer = setTimeout(() => {
    banner.hidden = true;
  }, 9000);
}

function selectService(service) {
  activeService = service;

  document.querySelectorAll('.service-tab').forEach((tab) => {
    const selected = tab.dataset.service === service;

    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-pressed', String(selected));
  });
}

function setServiceAvailability(service, available) {
  const tab = document.querySelector(
    `.service-tab[data-service="${service}"]`
  );

  if (tab) {
    tab.hidden = !available;
  }

  const visibleTabs = document.querySelectorAll(
    '.service-tab:not([hidden])'
  ).length;

  $('.service-switcher').classList.toggle(
    'single-service',
    visibleTabs === 1
  );
}

async function loadHub(forceRefresh = false, allowFallback = true) {
  const loadId = ++currentLoad;

  setBusy('Loading the upcoming worship plan…');
  dashboard.hidden = true;

  try {
    const data = await apiGet('hub', {
      service: activeService,
      refresh: forceRefresh ? '1' : '0',
      _: Date.now()
    });

    if (loadId !== currentLoad) return;

    if (data.available === false) {
      setServiceAvailability(activeService, false);

      const fallbackService = activeService === 'traditional'
        ? 'contemporary'
        : 'traditional';

      if (allowFallback) {
        selectService(fallbackService);
        await loadHub(forceRefresh, false);
        return;
      }

      throw new Error('No upcoming worship plan is available.');
    }

    setServiceAvailability(activeService, true);
    renderHub(data);

    // Read bookings directly so the list is fresh on either service tab.
    try {
      const schedule = await apiGet(
        'callSchedule',
        { _: Date.now() },
        true
      );

      if (loadId !== currentLoad) return;

      hubData.callSchedule = schedule;
      renderCallDates(schedule);
    } catch (scheduleError) {
      if (loadId !== currentLoad) return;
      renderCallDates(null);
    }
  } catch (error) {
    if (loadId !== currentLoad) return;

    setError(error.message);

    $('#plan-title').textContent = SERVICES[activeService].label;

    $('#plan-subtitle').textContent =
      'The worship information could not be loaded. ' +
      'Please tap the refresh button to try again.';
  }
}

document.querySelectorAll('.service-tab').forEach((button) => {
  button.addEventListener('click', () => {
    selectService(button.dataset.service);
    loadHub();
  });
});

$('#refresh-button').addEventListener('click', () => {
  loadHub(true);
});

$('#attendance-form').addEventListener('click', (event) => {
  if (event.target.matches('button[name="response"]')) {
    $('#attendance-form').dataset.response = event.target.value;
  }
});

$('#attendance-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const savingButton = event.submitter;
  const personId = $('#attendance-person').value;

  const personName =
    $('#attendance-person').selectedOptions[0]?.textContent || 'Your';

  const response = savingButton?.value || form.dataset.response;

  if (
    !personId ||
    !response ||
    !hubData?.attendanceKey ||
    form.dataset.saving === 'true'
  ) {
    return;
  }

  form.dataset.saving = 'true';
  setFormBusy(form, true, savingButton);
  setBusy('Saving your attendance response…');

  try {
    await apiPost('attendance', {
      attendanceKey: hubData.attendanceKey,
      personId,
      response
    });

    await loadHub();
    showAttendanceConfirmation(personName, response);
  } catch (error) {
    setError(error.message);
  } finally {
    setFormBusy(form, false, savingButton);
    form.dataset.saving = 'false';
  }
});

$('#call-person').addEventListener('change', updateCallControls);
$('#call-date').addEventListener('change', updateCallControls);

$('#call-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (callSaving || activeService !== 'traditional') {
    return;
  }

  const personId = $('#call-person').value;

  const personName =
    $('#call-person').selectedOptions[0]?.textContent || 'You';

  const worshipDate = $('#call-date').value;

  if (
    !personId ||
    !worshipDate ||
    !callSchedule?.dates?.includes(worshipDate)
  ) {
    return;
  }

  callSaving = true;
  updateCallControls();

  $('#call-submit').textContent = 'Saving…';

  showCallMessage(
    'Saving your Call to Worship booking. Please wait…'
  );

  try {
    await apiPost('callToWorship', {
      personId,
      worshipDate
    });

    showCallMessage('Checking your booking. Please wait…');

    const booking = await verifyCallBooking(
      worshipDate,
      personId
    );

    showCallMessage(
      (booking.personName || personName) +
      ', you’re scheduled for ' +
      formatCallDate(worshipDate) +
      ' at 9:30 AM. Thank you!',
      true
    );

    $('#call-date').value = '';
  } catch (error) {
    showCallMessage(
      error.message ||
      'Your booking could not be confirmed. Please try again.'
    );

    try {
      await refreshCallSchedule();
    } catch (refreshError) {
      renderCallDates(null);
    }
  } finally {
    callSaving = false;
    $('#call-submit').textContent = 'I’ll Volunteer';
    updateCallControls();
  }
});

const installButton = $('#install-button');
const installDialog = $('#install-dialog');
const instructions = $('#install-instructions');

let deferredInstallPrompt = null;

function showInstructions() {
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  if (standalone) {
    instructions.innerHTML =
      '<p>The Worship Hub is already saved to this device.</p>';
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    instructions.innerHTML =
      '<ol>' +
      '<li>Open this page in <strong>Safari</strong>.</li>' +
      '<li>Tap the <strong>Share</strong> button.</li>' +
      '<li>Tap <strong>Add to Home Screen</strong>.</li>' +
      '<li>Tap <strong>Add</strong>.</li>' +
      '</ol>';
  } else if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    return;
  } else {
    instructions.innerHTML =
      '<ol>' +
      '<li>Open your browser menu.</li>' +
      '<li>Choose <strong>Install app</strong> or ' +
      '<strong>Add to Home Screen</strong>.</li>' +
      '<li>Follow the message on your screen.</li>' +
      '</ol>';
  }

  installDialog.showModal();
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

installButton.addEventListener('click', showInstructions);

$('#close-dialog').addEventListener('click', () => {
  installDialog.close();
});

installDialog.addEventListener('click', (event) => {
  if (event.target === installDialog) {
    installDialog.close();
  }
});

function updateConnectionStatus() {
  $('#offline-message').hidden = navigator.onLine;
  updateCallControls();
}

window.addEventListener('online', () => {
  updateConnectionStatus();
  loadHub();
});

window.addEventListener('offline', updateConnectionStatus);

updateConnectionStatus();
loadHub();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js');
  });
}
