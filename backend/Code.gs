/**
 * VUMC Worship Hub backend
 *
 * Required Script Properties:
 * PCO_APP_ID, PCO_SECRET, SPREADSHEET_ID
 * Optional: TRADITIONAL_SERVICE_TYPE, CONTEMPORARY_SERVICE_TYPE
 */
const HUB = {
  traditional: { id: '1525584', name: '9:30 Traditional Worship' },
  contemporary: { id: '1061239', name: '10:30 Contemporary Worship' }
};

function doGet(e) {
  try {
    const action = String((e && e.parameter.action) || 'hub');
    if (action !== 'hub') throw new Error('Unknown request.');
    return json_(getHub_(String(e.parameter.service || 'traditional')));
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const p = e.parameter || {};
    if (p.action === 'attendance') return json_(saveAttendance_(p));
    if (p.action === 'callToWorship') return json_(saveCall_(p));
    throw new Error('Unknown request.');
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function setupWorshipHub() {
  const ss = SpreadsheetApp.openById(property_('SPREADSHEET_ID'));
  ensureSheet_(ss, 'Attendance', ['Plan ID', 'Person ID', 'Response', 'Updated']);
  ensureSheet_(ss, 'Assignments', ['Plan ID', 'Role', 'Person ID', 'Person Name', 'Updated']);
}

function getHub_(serviceKey) {
  const service = HUB[serviceKey] || HUB.traditional;
  const propertyName = serviceKey === 'contemporary' ? 'CONTEMPORARY_SERVICE_TYPE' : 'TRADITIONAL_SERVICE_TYPE';
  service.id = PropertiesService.getScriptProperties().getProperty(propertyName) || service.id;
  const plans = pco_('/services/v2/service_types/' + service.id + '/plans?filter=future&order=sort_date&per_page=1').data || [];
  if (!plans.length) throw new Error('No upcoming public plan was found.');
  const plan = plans[0];
  const items = pco_('/services/v2/service_types/' + service.id + '/plans/' + plan.id + '/items?per_page=100&order=sequence').data || [];
  const servingPayload = pco_('/services/v2/service_types/' + service.id + '/plans/' + plan.id + '/team_members?per_page=100&include=team');
  const teamNames = {};
  (servingPayload.included || []).filter(function (entry) { return entry.type === 'Team'; }).forEach(function (team) {
    teamNames[team.id] = team.attributes.name;
  });
  const choir = serviceKey === 'traditional' ? getChoir_() : [];
  return {
    ok: true,
    service: service,
    plan: {
      id: plan.id,
      date: plan.attributes.sort_date,
      title: plan.attributes.title || '',
      publicUrl: 'https://versaillesumc.churchcenter.com/services/service_types/' + service.id + '/plans/' + plan.id + '/public'
    },
    items: items.map(function (item) {
      return { id: item.id, title: item.attributes.title || '', description: item.attributes.description || '', sequence: item.attributes.sequence || 0, people: [] };
    }),
    serving: (servingPayload.data || []).map(function (person) {
      const teamId = person.relationships.team && person.relationships.team.data ? person.relationships.team.data.id : '';
      return { name: person.attributes.name, position: person.attributes.team_position_name || '', team: teamNames[teamId] || '', status: person.attributes.status || 'U' };
    }),
    choir: choir,
    attendance: serviceKey === 'traditional' ? getAttendance_(plan.id) : [],
    callToWorship: serviceKey === 'traditional' ? getCall_(plan.id) : null
  };
}

function getChoir_() {
  const fieldId = PropertiesService.getScriptProperties().getProperty('CHOIR_FIELD_ID') || '1107643';
  const payload = pco_('/people/v2/field_data?where[field_definition_id]=' + fieldId + '&where[value]=true&per_page=100');
  const ids = (payload.data || []).map(function (datum) {
    return datum.relationships.customizable.data.id;
  });
  const auth = 'Basic ' + Utilities.base64Encode(property_('PCO_APP_ID') + ':' + property_('PCO_SECRET'));
  const responses = UrlFetchApp.fetchAll(ids.map(function (id) {
    return { url: 'https://api.planningcenteronline.com/people/v2/people/' + id, headers: { Authorization: auth }, muteHttpExceptions: true };
  }));
  return responses.map(function (response) {
    if (response.getResponseCode() >= 300) throw new Error('A choir profile could not be loaded.');
    return JSON.parse(response.getContentText()).data;
  }).map(function (person) {
    const a = person.attributes || {};
    const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || 'Choir member';
    return { id: person.id, name: name, displayName: [a.first_name, a.last_name ? a.last_name.charAt(0) + '.' : ''].filter(Boolean).join(' ') };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function getAttendance_(planId) {
  const sheet = sheet_('Attendance');
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function (row) { return String(row[0]) === String(planId); })
    .map(function (row) { return { personId: String(row[1]), response: String(row[2]) }; });
}

function saveAttendance_(p) {
  requireFields_(p, ['planId', 'personId', 'response']);
  if (['present', 'absent'].indexOf(p.response) === -1) throw new Error('Invalid attendance response.');
  assertChoirMember_(p.personId);
  const sheet = sheet_('Attendance');
  const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues() : [];
  const index = values.findIndex(function (row) { return String(row[0]) === String(p.planId) && String(row[1]) === String(p.personId); });
  const row = [String(p.planId), String(p.personId), p.response, new Date()];
  if (index >= 0) sheet.getRange(index + 2, 1, 1, 4).setValues([row]);
  else sheet.appendRow(row);
  return { ok: true };
}

function getCall_(planId) {
  const sheet = sheet_('Assignments');
  if (sheet.getLastRow() < 2) return null;
  const row = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues()
    .find(function (value) { return String(value[0]) === String(planId) && value[1] === 'Call to Worship'; });
  return row ? { personId: String(row[2]), personName: String(row[3]) } : null;
}

function saveCall_(p) {
  requireFields_(p, ['planId', 'personId']);
  const person = assertChoirMember_(p.personId);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (getCall_(p.planId)) throw new Error('Someone has already volunteered for the Call to Worship.');
    sheet_('Assignments').appendRow([String(p.planId), 'Call to Worship', String(person.id), person.name, new Date()]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function assertChoirMember_(personId) {
  const person = getChoir_().find(function (entry) { return String(entry.id) === String(personId); });
  if (!person) throw new Error('Please choose a name from the active choir roster.');
  return person;
}

function pco_(path) {
  const id = property_('PCO_APP_ID');
  const secret = property_('PCO_SECRET');
  const response = UrlFetchApp.fetch('https://api.planningcenteronline.com' + path, {
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(id + ':' + secret) },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 300) throw new Error('Planning Center request failed (' + response.getResponseCode() + ').');
  return JSON.parse(response.getContentText());
}

function sheet_(name) {
  return SpreadsheetApp.openById(property_('SPREADSHEET_ID')).getSheetByName(name);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (!sheet.getLastRow()) sheet.appendRow(headers);
  sheet.setFrozenRows(1);
}

function property_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Missing Script Property: ' + name);
  return value;
}

function requireFields_(object, fields) {
  fields.forEach(function (field) { if (!object[field]) throw new Error('Missing value: ' + field); });
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
