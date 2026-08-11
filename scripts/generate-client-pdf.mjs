import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'AP-Emlaki-Docker-Runbook-and-Client-Brief.pdf');
const doc = new PDFDocument({ size: 'A4', margins: { top: 58, bottom: 58, left: 58, right: 58 }, info: {
  Title: 'AP Emlaki - Docker Runbook and Client Brief',
  Author: 'AP Emlaki Project',
  Subject: 'Deployment instructions and product overview',
} });

const stream = fs.createWriteStream(output);
doc.pipe(stream);
const pageWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function ensure(height = 40) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom - 10) doc.addPage();
}

function title(text) {
  ensure(60);
  doc.fillColor('#17354d').font('Helvetica-Bold').fontSize(19).text(text, { width: pageWidth(), paragraphGap: 8 });
  doc.moveDown(0.3);
}

function heading(text) {
  ensure(38);
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(13).text(text, { width: pageWidth(), paragraphGap: 5 });
  doc.moveDown(0.15);
}

function paragraph(text) {
  const height = doc.heightOfString(text, { width: pageWidth(), font: 'Helvetica', fontSize: 9.5, lineGap: 3 });
  ensure(height + 15);
  doc.fillColor('#263646').font('Helvetica').fontSize(9.5).text(text, { width: pageWidth(), lineGap: 3, paragraphGap: 8 });
}

function bullet(text) {
  const width = pageWidth() - 16;
  const height = doc.heightOfString(text, { width, font: 'Helvetica', fontSize: 9.5, lineGap: 2 });
  ensure(height + 12);
  const y = doc.y;
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(10).text('\u2022', doc.page.margins.left, y, { width: 10 });
  doc.fillColor('#263646').font('Helvetica').fontSize(9.5).text(text, doc.page.margins.left + 14, y, { width, lineGap: 2, paragraphGap: 5 });
}

function code(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : lines;
  const height = doc.heightOfString(text, { width: pageWidth() - 22, font: 'Courier', fontSize: 8.5, lineGap: 2 }) + 20;
  ensure(height + 10);
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.save().fillColor('#f0f4f7').roundedRect(x, y, pageWidth(), height, 5).fill().restore();
  doc.fillColor('#263646').font('Courier').fontSize(8.5).text(text, x + 11, y + 10, { width: pageWidth() - 22, lineGap: 2 });
  doc.y = y + height + 8;
}

function labelValue(label, value) {
  ensure(20);
  doc.fillColor('#536878').font('Helvetica-Bold').fontSize(9.5).text(label, { continued: true });
  doc.fillColor('#263646').font('Helvetica').text(` ${value}`, { paragraphGap: 5 });
}

title('AP Emlaki');
doc.fillColor('#536878').font('Helvetica').fontSize(15).text('Docker Runbook and Client Brief', { paragraphGap: 8 });
doc.fillColor('#145394').font('Helvetica-Bold').fontSize(10).text('Release: 1812-compatible Node.js port | Document language: English');
doc.moveDown(1);
paragraph('This document explains how to run AP Emlaki with Docker and provides a customer-facing overview of the product, its workflows, security model, data storage and operational requirements.');
labelValue('Application URL', 'http://localhost:3000');
labelValue('Docker container', 'ap-emlaki');
labelValue('Docker image', 'ap-emlaki:1812');
labelValue('Technology', 'Node.js, Express, Prisma, SQLite and EJS');

heading('1. Quick Start with Docker');
paragraph('Install Docker Desktop and make sure its engine is running. Open PowerShell in the project directory and run:');
code(['cd "C:\\Users\\Davoodsina\\Desktop\\amlaki-lastUpdate"', 'docker compose up -d --build']);
paragraph('The first run builds the image and creates persistent Docker volumes. Open http://localhost:3000 after the container becomes healthy. Future daily starts normally require only docker compose up -d.');

heading('2. Daily Administration Commands');
code([
  'docker compose up -d',
  'docker compose ps',
  'docker compose logs -f app',
  'docker compose restart app',
  'docker compose down',
  'docker compose up -d --build',
]);
bullet('Use docker compose up -d for a normal start.');
bullet('Use --build after changing application code, dependencies or Docker files.');
bullet('docker compose down removes the container and network but preserves named data volumes.');
bullet('The service uses restart: unless-stopped and starts automatically with Docker Desktop.');

heading('3. Configuration');
paragraph('Docker Compose reads optional overrides from .env. Start from .env.example and set a long random SESSION_SECRET before public deployment.');
code([
  'APP_PORT=3000',
  'SESSION_SECRET=generate-a-long-random-secret',
  'SESSION_COOKIE_SECURE=false',
  'TRUST_PROXY=0',
  'GEOCODING_PROVIDER=nominatim',
  'GEOCODING_API_KEY=',
]);
bullet('Set SESSION_COOKIE_SECURE=true when the site is delivered through HTTPS.');
bullet('Set TRUST_PROXY=1 only when a trusted reverse proxy terminates HTTPS.');
bullet('Change APP_PORT if port 3000 is already occupied, for example APP_PORT=8080.');
bullet('Never send or commit real passwords, API keys or session secrets.');

heading('4. Persistent Data');
paragraph('The deployment stores business data, sessions and uploaded files outside the container. Rebuilding or restarting the application therefore does not remove customer data.');
labelValue('Application data volume', 'amlaki-lastupdate_app-data');
labelValue('Upload volume', 'amlaki-lastupdate_app-uploads');
labelValue('Database inside container', '/app/data/dev.db');
labelValue('Session directory', '/app/data/sessions');
paragraph('The startup script never applies a potentially destructive schema conversion automatically. Existing databases are opened without modification. Review Prisma warnings and back up the data before applying schema changes manually:');
code('npm run docker:schema');

heading('5. Backup and Recovery');
paragraph('Back up both named volumes on a regular schedule. The following PowerShell commands create compressed archives in the current directory:');
code([
  'docker run --rm -v amlaki-lastupdate_app-data:/data -v "${PWD}:/backup" alpine tar czf /backup/ap-emlaki-data-backup.tar.gz -C /data .',
  'docker run --rm -v amlaki-lastupdate_app-uploads:/data -v "${PWD}:/backup" alpine tar czf /backup/ap-emlaki-uploads-backup.tar.gz -C /data .',
]);
paragraph('For recovery, stop the application, restore each archive to the matching volume and start the service again. Keep dated backups outside the Docker host and test restoration periodically.');

heading('6. Health Check and Troubleshooting');
paragraph('Docker monitors the application through /healthz. A healthy response confirms that both the web application and SQLite database are available.');
code('Invoke-WebRequest http://localhost:3000/healthz');
paragraph('Expected response: {"status":"ok","database":"ready"}. Useful diagnostic commands:');
code(['docker compose ps', 'docker compose logs --tail=200 app', 'docker volume ls']);
bullet('If the site does not open, verify that the container is healthy and the configured port is free.');
bullet('If the container restarts, inspect application logs before recreating volumes.');
bullet('If login fails, verify that an active user exists and that the browser uses the current URL.');
bullet('Do not run a forced schema update without a current backup.');

title('Customer Brief');
heading('7. Product Overview');
paragraph('AP Emlaki is a browser-based property-management platform for property managers, landlords and administrative teams. It consolidates operational, financial and communication workflows in one secured application. The current implementation is a source-compatible Node.js port of the INtex Hausverwaltung 1812 application.');
bullet('Properties and units: buildings, units, rooms, areas, occupancy, ownership, rent and operating information.');
bullet('Contacts: tenants, owners, suppliers, craftsmen, administrators and classifications.');
bullet('Contracts and administration: agreements, responsibilities, documents, notes, tasks and appointments.');
bullet('Accounting: bookings, account structures, recurring bookings, bank imports, cost allocation and SEPA XML.');
bullet('Documents and media: controlled upload, download, preview, thumbnails and full-text display.');
bullet('Reports and exports: CSV, Excel, Word, XML, PDF, DATEV and mail-merge formats.');
bullet('Dashboards and charts: seven dashboards and eighteen analytical chart definitions.');

heading('8. How the System Works');
paragraph('The browser sends requests to the Express application. Express validates the user session, checks CSRF tokens for changes, applies permission masks and restricts Team-scoped data. Metadata-driven engines render the majority of list, form, search, import, export, print, report, chart and dashboard pages. Prisma executes database operations against SQLite.');
code([
  'Browser',
  '  -> Express routes and EJS views',
  '  -> Authentication, CSRF, permissions and Team scope',
  '  -> Metadata-driven and specialized business engines',
  '  -> Prisma ORM',
  '  -> SQLite + persistent upload/session volumes',
]);
paragraph('Source metadata defines labels, fields, lookups, relationships, dashboards, charts, exports, reports and button actions. Generic engines provide consistent behavior, while specialized modules implement accounting, bank imports, SEPA, webhooks, geocoding and other business operations.');

heading('9. Typical User Workflow');
paragraph('1. The user signs in. The system loads the user group, access rights and Team. 2. The user opens a module such as Properties, Contacts or Units. 3. Lists and searches show only authorized records. 4. Forms create or update records and enforce field rules. 5. Related documents, notes, tasks, appointments and child records can be attached. 6. Authorized users run reports, exports, accounting actions and imports. 7. Audit logging records important changes.');

heading('10. Security Model');
bullet('Passwords are stored as bcrypt hashes for new and upgraded credentials.');
bullet('Sessions use HTTP-only and same-site cookies and persist in a file-backed Docker volume.');
bullet('All state-changing requests require a CSRF token.');
bullet('Access masks control read, add, edit, delete, export, print and import operations.');
bullet('Team filtering applies to lists, direct records, lookups, imports, files and accounting actions.');
bullet('Uploads are not exposed through an unrestricted public directory.');
bullet('Rich text is sanitized against an explicit allowlist.');
bullet('Download names, chart labels, markup and export values are escaped or validated.');

heading('11. Import, Export and Automation');
paragraph('The import wizard supports CSV, XLSX, vCard and iCalendar input with preview, field mapping, validation, duplicate policy and result summaries. Specialized bank imports reproduce the original booking side effects. Export engines provide office formats, PDF, DATEV and mail-merge datasets. Monthly recurring bookings run through a scheduled job, while webhooks and SMTP integrations are configured per Team.');

heading('12. Customer Responsibilities');
bullet('Keep Docker Desktop and the host operating system updated.');
bullet('Maintain off-host backups of application data and uploads.');
bullet('Use HTTPS and a trusted reverse proxy for internet-facing deployments.');
bullet('Protect administrator credentials, session secrets, SMTP passwords and API keys.');
bullet('Review user permissions and Team assignments whenever staffing changes.');
bullet('Test schema migrations and bulk imports on a backup before production use.');

heading('13. Maintenance and Acceptance');
paragraph('The project includes automated regression tests, chart smoke tests and a PHP/Node parity runner. The current validated baseline reports 213 passing tests, 18 successful chart smoke checks and zero differences in the shared parity fixture. Docker health, login, CRUD access and session persistence across container restarts have also been validated.');
code(['npm test', 'npm run smoke:charts', 'npm run parity']);

heading('14. Support Information');
paragraph('When reporting a problem, provide the timestamp, browser URL, affected module, user role, Docker service status and the last relevant application log lines. Do not include passwords, session cookies, private documents or API credentials in a support request.');

heading('Document Status');
paragraph('This runbook describes the Docker deployment and customer workflows validated for the current AP Emlaki 1812-compatible project snapshot.');

const finished = new Promise((resolve, reject) => {
  stream.on('finish', resolve);
  stream.on('error', reject);
});
doc.end();
await finished;
console.log(output);
