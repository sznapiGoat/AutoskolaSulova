import puppeteer from 'puppeteer';
import fs from 'fs';

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--lang=cs-CZ'],
    defaultViewport: null
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  // Go to Google Maps search
  console.log('Going to Google Maps...');
  await page.goto('https://www.google.com/maps?hl=cs', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Accept cookies
  try {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const txt = await page.evaluate(b => b.innerText, btn);
      if (txt.includes('Přijmout') || txt.includes('Accept') || txt.includes('Agree')) {
        await btn.click(); await new Promise(r => setTimeout(r, 1500)); console.log('Accepted:', txt); break;
      }
    }
  } catch {}

  // Search for the business
  console.log('Searching for business...');
  await page.waitForSelector('#searchboxinput', { timeout: 10000 });
  await page.click('#searchboxinput');
  await page.type('#searchboxinput', 'Autoškola Barbora Šůlová Rokycany');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 4000));

  console.log('URL after search:', page.url());
  await page.screenshot({ path: '../maps1.png' });

  // Click on the first result in search
  try {
    const firstResult = await page.$('.hfpxzc, a[href*="maps/place"]');
    if (firstResult) { await firstResult.click(); await new Promise(r => setTimeout(r, 3000)); }
  } catch {}

  await page.screenshot({ path: '../maps2.png' });
  console.log('URL after click:', page.url());

  // Find and click the Reviews tab
  await new Promise(r => setTimeout(r, 2000));
  const allButtons = await page.$$('button[role="tab"]');
  console.log(`Found ${allButtons.length} tab buttons`);
  let reviewsTab = null;
  for (const btn of allButtons) {
    const txt = await page.evaluate(b => b.innerText?.trim() || b.getAttribute('aria-label') || '', btn);
    console.log(' tab text:', txt);
    if (txt.toLowerCase().includes('recenze') || txt.toLowerCase().includes('review')) {
      reviewsTab = btn;
    }
  }

  if (reviewsTab) {
    await reviewsTab.click();
    console.log('Clicked reviews tab');
    await new Promise(r => setTimeout(r, 3000));
  } else {
    // Try aria-label
    try {
      await page.click('[aria-label*="Recenze"]');
      console.log('Clicked via aria-label');
      await new Promise(r => setTimeout(r, 3000));
    } catch {
      // Try data-tab
      const tabLinks = await page.$$('[role="tablist"] button, .Gpq6kf button');
      for (const t of tabLinks) {
        const txt = await page.evaluate(b => b.innerText, t);
        console.log(' tablink:', txt);
      }
    }
  }

  await page.screenshot({ path: '../maps3.png' });

  // Find the scrollable reviews panel
  const panelInfo = await page.evaluate(() => {
    const selectors = [
      '[role="feed"]',
      '.m6QErb.DxyBCb',
      '.m6QErb[aria-label]',
      '.bJzME',
      '[data-review-id]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return { sel, scrollHeight: el.scrollHeight, found: true };
    }
    return { found: false, bodySnippet: document.body.innerText.substring(0, 500) };
  });
  console.log('Panel:', JSON.stringify(panelInfo));

  // Scroll reviews
  console.log('Scrolling reviews...');
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => {
      const feed = document.querySelector('[role="feed"]') ||
        document.querySelector('.m6QErb.DxyBCb') ||
        document.querySelector('.m6QErb[aria-label]');
      if (feed) feed.scrollTop += 500;
      else window.scrollBy(0, 500);
    });
    await new Promise(r => setTimeout(r, 500));

    if (i % 10 === 9) {
      const count = await page.evaluate(() => document.querySelectorAll('.jftiEf').length);
      console.log(`  Scroll ${i+1}: ${count} review containers found`);
    }
  }

  // Expand texts
  let expanded = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const moreBtns = await page.$$('.w8nwRe');
    for (const btn of moreBtns) {
      try { await btn.click(); await new Promise(r => setTimeout(r, 80)); expanded++; } catch {}
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`Expanded ${expanded} texts`);

  // Extract
  const reviews = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    document.querySelectorAll('.jftiEf').forEach(el => {
      const author = el.querySelector('.d4r55')?.innerText?.trim() || null;
      const ratingLabel = el.querySelector('.kvMYJc')?.getAttribute('aria-label') || '';
      const stars = ratingLabel.match(/(\d+)/)?.[1] ? parseInt(ratingLabel.match(/(\d+)/)[1]) : null;
      const text = el.querySelector('.wiI7pd')?.innerText?.trim() || null;
      const date = el.querySelector('.rsqaWe')?.innerText?.trim() || null;
      const key = `${author}|||${text?.substring(0, 50)}`;
      if (!seen.has(key)) { seen.add(key); results.push({ author, stars, date, text }); }
    });
    return results;
  });

  console.log(`\n=== ${reviews.length} reviews ===`);
  reviews.forEach((r, i) => {
    console.log(`[${i+1}] ${r.author} ${r.stars}★ ${r.date}`);
    if (r.text) console.log(`     "${r.text.substring(0, 100)}..."`);
  });

  if (reviews.length > 0) {
    fs.writeFileSync('../reviews-raw.json', JSON.stringify(reviews, null, 2), 'utf-8');
    console.log('Saved to reviews-raw.json');
  }

  await page.screenshot({ path: '../maps-final.png', fullPage: false });
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
}

main().catch(console.error);
