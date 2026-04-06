#!/usr/bin/env node
/**
 * Saola Dock Browser Server
 *
 * Persistent Puppeteer HTTP server for browser automation.
 * Launches Chrome visible (headless: false) with a specific profile's userDataDir.
 * Commands via POST /action, JSON responses.
 *
 * Usage: node browser-server.js <profileDir> <profileId> [profileName]
 * Outputs: {"ready":true,"port":XXXX,"pid":XXXX} on stdout when ready
 */

import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const profileDir = process.argv[2];
const profileId = process.argv[3] || 'default';
const profileName = process.argv[4] || 'Browser';
const windowTitle = `Saola - ${profileName}`;

if (!profileDir) {
  console.error(JSON.stringify({ ready: false, error: 'Usage: node browser-server.js <profileDir> <profileId>' }));
  process.exit(1);
}

const STATE_DIR = path.join(os.homedir(), '.saola-dock', 'browser-profiles');
const SERVER_FILE = path.join(STATE_DIR, `.server-${profileId}.json`);

let browser, page;

async function launchBrowser() {
  browser = await puppeteer.launch({
    headless: false,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Anti-detection + window title for every new page
  browser.on('targetcreated', async (target) => {
    try {
      const p = await target.page();
      if (p) {
        await p.evaluateOnNewDocument((title) => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          // Override document.title so the window shows our custom title
          Object.defineProperty(document, 'title', {
            get: () => title,
            set: () => {},
          });
        }, windowTitle);
      }
    } catch {}
  });

  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();

  // Set title on the initial page
  await page.evaluateOnNewDocument((title) => {
    Object.defineProperty(document, 'title', {
      get: () => title,
      set: () => {},
    });
  }, windowTitle);
  await page.evaluate((title) => { document.title = title; }, windowTitle);
}

/** Get the currently visible/active page */
async function getActivePage() {
  const pages = await browser.pages();
  if (pages.length === 0) return page;
  for (const p of pages) {
    try {
      const visible = await p.evaluate(() => document.visibilityState === 'visible');
      if (visible) { page = p; return p; }
    } catch {}
  }
  page = pages[pages.length - 1];
  return page;
}

/** Execute a browser action */
async function handleAction(body) {
  const { action, selector, value, url } = body;
  await getActivePage();

  switch (action) {
    case 'navigate': {
      const target = url || selector;
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 30000 });
      return { success: true, url: page.url(), title: await page.title() };
    }

    case 'click': {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      return { success: true, result: `Clicked: ${selector}` };
    }

    case 'type': {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector, { clickCount: 3 });
      await page.type(selector, value || '', { delay: 30 });
      return { success: true, result: `Typed into: ${selector}` };
    }

    case 'screenshot': {
      await new Promise((r) => setTimeout(r, 500));
      const data = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 70, fullPage: false });
      return { success: true, image: data };
    }

    case 'get_text': {
      const el = selector ? await page.$(selector) : null;
      const text = el
        ? await page.$eval(selector, (e) => e.textContent || '')
        : await page.$eval('body', (e) => e.textContent || '');
      return { success: true, text: text.trim().substring(0, 5000) };
    }

    case 'get_html': {
      const raw = await page.content();
      const clean = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .substring(0, 8000);
      return { success: true, html: clean };
    }

    case 'scroll': {
      const pixels = parseInt(value || '500');
      await page.evaluate((px) => window.scrollBy(0, px), pixels);
      return { success: true, result: `Scrolled ${pixels}px` };
    }

    case 'wait': {
      if (selector) {
        await page.waitForSelector(selector, { timeout: 10000 });
        return { success: true, result: `Element appeared: ${selector}` };
      }
      await new Promise((r) => setTimeout(r, parseInt(value || '1000')));
      return { success: true, result: 'Waited' };
    }

    case 'evaluate': {
      const result = await page.evaluate(new Function(`return (${value})()`));
      return { success: true, result: JSON.stringify(result) };
    }

    case 'current_url': {
      return { success: true, url: page.url(), title: await page.title() };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

async function main() {
  await launchBrowser();

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/action') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST /action only' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleAction(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(SERVER_FILE, JSON.stringify({ port, pid: process.pid, profileId, profileDir }));

    // Signal ready to Rust
    console.log(JSON.stringify({ ready: true, port, pid: process.pid }));
  });

  const cleanup = async () => {
    try { await browser.close(); } catch {}
    try { fs.unlinkSync(SERVER_FILE); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  browser.on('disconnected', () => {
    try { fs.unlinkSync(SERVER_FILE); } catch {}
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(JSON.stringify({ ready: false, error: e.message }));
  process.exit(1);
});
