# VUMC Worship Hub

An installable worship-plan and attendance hub for Versailles United Methodist Church.

## Version 2

- Renders the upcoming 9:30 and 10:30 plans in the Hub's own accessible design
- Pulls the active Choir roster from a Planning Center People list
- Saves Present/Absent responses for each upcoming plan
- Shows shared Present, Absent, and No response totals
- Allows one active choir member to volunteer for the Call to Worship
- Keeps a Church Center link available as a fallback
- Keeps all PCO credentials in Google Apps Script Properties

## Service-aware behavior

- Uses neutral 9:30 Worship and 10:30 Worship tabs instead of assuming a fixed style.
- Treats a 10:30 plan as Combined Worship when there is no 9:30 plan for the same date.
- Keeps one general Sunday worship-attendance roster, independent of the 9:30 and 10:30 service plans.
- Stores each response by worship date so the same attendance appears while viewing either service.
- Reads older plan-ID responses and converts submissions from cached older pages to the current worship date.
- Normalizes Google Sheets date cells and safely handles Apps Script's redirected POST response.
- Shows the Call to Worship signup only when that item exists in the active plan.
- Skips a service with no plan for the earliest upcoming worship date instead of showing an error.

## Google Sheet

Create a Google Sheet for the Hub. The setup function creates these tabs:

- Attendance: Worship Date, Person ID, Person Name, Response, Updated
- Assignments: Plan ID, Role, Person ID, Person Name, Updated

## Apps Script deployment

1. In the Sheet, open **Extensions > Apps Script**.
2. Replace Code.gs with backend/Code.gs.
3. Open **Project Settings > Script Properties** and add:

| Property | Value |
|---|---|
| PCO_APP_ID | Existing Planning Center application ID |
| PCO_SECRET | Existing Planning Center secret |
| SPREADSHEET_ID | ID from this Sheet's URL |
| CHOIR_FIELD_ID | 1107643 (the Ministry Involvement > Choir field) |
| ATTENDANCE_FIELD_ID | Optional separate Boolean field for everyone who should report worship attendance; defaults to CHOIR_FIELD_ID |
| TRADITIONAL_SERVICE_TYPE | 1525584 |
| CONTEMPORARY_SERVICE_TYPE | 1061239 |

4. Run setupWorshipHub once and approve access.
5. Choose **Deploy > New deployment > Web app**.
6. Execute as **Me** and allow access to **Anyone**.
7. Copy the deployed URL ending in /exec.
8. Paste it into config.js as the apiUrl.

Never put PCO credentials in config.js or any GitHub file.

## Worship attendance roster

By default, the backend uses profiles whose Ministry Involvement > Choir Boolean field is Yes, so the current setup continues to work unchanged. To separate service attendance from choir membership, create a Boolean field in Planning Center for everyone who should report availability and save its field ID as `ATTENDANCE_FIELD_ID` in Apps Script Properties.

## GitHub Pages

Publish the main branch from / (root). The custom domain is:

https://worship.versaillesumc.org
