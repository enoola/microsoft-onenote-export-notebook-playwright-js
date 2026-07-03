/**
 * diagnose-notebook-newpage.js
 *
 * Diagnostic: opens a notebook and listens for new page/popup events
 * to capture the actual OneNote editor URL when it opens.
 *
 * Usage:
 *   node src/diagnose-notebook-newpage.js --auth-file <path> --notebook <name>
 */
const fs = require('fs-extra');
const path = require('path');
const { getAuthenticatedContextWithFile } = require('./auth-context');
const { ONENOTE_URL } = require('./config');

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const authFile = get('--auth-file');
const notebookName = get('--notebook');

if (!authFile || !notebookName) {
    console.error('Usage: node src/diagnose-notebook-newpage.js --auth-file <path> --notebook <name>');
    process.exit(1);
}

const DUMP_DIR = path.resolve(__dirname, '../diag-dumps');
const NOTEBOOK_IMG_SELECTOR = 'tr img[alt="Classic Notebook"]';

async function run() {
    await fs.ensureDir(DUMP_DIR);
    const { browser, context } = await getAuthenticatedContextWithFile(authFile, false);

    // Listen for ANY new page created in this context
    const newPages = [];
    context.on('page', (newPage) => {
        const url = newPage.url();
        console.log(`[EVENT] New page created: ${url}`);
        newPages.push(newPage);
        newPage.on('load', () => console.log(`[EVENT] New page loaded: ${newPage.url()}`));
    });

    const page = await context.newPage();

    // Also listen for navigation events on the main page
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            console.log(`[NAV] Main frame navigated: ${frame.url()}`);
        } else {
            console.log(`[NAV] Sub-frame navigated: ${frame.url().substring(0, 100)}`);
        }
    });

    console.log('[DIAG] Navigating to notebooks list...');
    await page.goto(ONENOTE_URL);
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});

    console.log('[DIAG] Waiting for notebook list...');
    await page.waitForSelector(NOTEBOOK_IMG_SELECTOR, { state: 'attached', timeout: 60000 });

    // Find the target notebook
    const rowIndex = await page.evaluate(({ name, imgSel }) => {
        const imgs = Array.from(document.querySelectorAll(imgSel));
        for (const img of imgs) {
            const span = img.nextElementSibling;
            if (span && span.innerText.trim() === name) {
                const tr = img.closest('tr');
                return tr ? tr.rowIndex : -1;
            }
        }
        return -1;
    }, { name: notebookName, imgSel: NOTEBOOK_IMG_SELECTOR });

    if (rowIndex < 0) {
        console.error(`[DIAG] Notebook "${notebookName}" not found!`);
        await browser.close();
        process.exit(1);
    }

    console.log(`[DIAG] Found notebook at row ${rowIndex}. Clicking...`);
    console.log(`[DIAG] URL before click: ${page.url()}`);

    // Listen for new page popup BEFORE clicking
    const newPagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);

    await page.evaluate(({ idx, imgSel }) => {
        const imgs = Array.from(document.querySelectorAll(imgSel));
        for (const img of imgs) {
            const tr = img.closest('tr');
            if (tr && tr.rowIndex === idx) {
                const span = img.nextElementSibling;
                if (span) { span.click(); return; }
                tr.click(); return;
            }
        }
    }, { idx: rowIndex, imgSel: NOTEBOOK_IMG_SELECTOR });

    console.log('[DIAG] Click sent. Waiting 3s...');
    await page.waitForTimeout(3000);
    console.log(`[DIAG] URL after click: ${page.url()}`);

    const newPage = await newPagePromise;
    if (newPage) {
        console.log(`[DIAG] ✓ New page/popup detected: ${newPage.url()}`);
        await newPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        console.log(`[DIAG] New page final URL: ${newPage.url()}`);

        const screenshotPath = path.join(DUMP_DIR, 'diag_newpage_screenshot.png');
        await newPage.screenshot({ path: screenshotPath });
        console.log(`[DIAG] Screenshot: ${screenshotPath}`);

        const htmlPath = path.join(DUMP_DIR, 'diag_newpage.html');
        await fs.writeFile(htmlPath, await newPage.content());
        console.log(`[DIAG] HTML: ${htmlPath}`);
    } else {
        console.log('[DIAG] No popup/new page detected within 15s.');
        console.log(`[DIAG] Main page frames:`, page.frames().map(f => f.url().substring(0, 100)));
    }

    console.log(`[DIAG] Main page frames after 3s:`, page.frames().map(f => f.url().substring(0, 100)));

    // Wait 10 more seconds to catch any delayed navigation
    console.log('[DIAG] Waiting 10 more seconds for delayed events...');
    await page.waitForTimeout(10000);
    console.log(`[DIAG] Final URL: ${page.url()}`);
    console.log(`[DIAG] Final frames:`, page.frames().map(f => f.url().substring(0, 100)));
    console.log(`[DIAG] New pages detected total: ${newPages.length}`);

    await browser.close();
    console.log('[DIAG] Done.');
}

run().catch(err => {
    console.error('[DIAG] Fatal:', err);
    process.exit(1);
});
