import puppeteer from 'puppeteer';
import fs from 'fs';

const SHARE_URL = 'https://share.google/wvRjW1HXT2dNOMT2R';

async function scrapeReviews() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=cs-CZ,cs']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'cs-CZ,cs;q=0.9' });

  console.log('Navigating to share URL...');
  await page.goto(SHARE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const redirectedUrl = page.url();
  console.log('Redirected to:', redirectedUrl);

  // Take a screenshot to see what we got
  await page.screenshot({ path: '../reviews-debug.png', fullPage: false });

  // Try to get page title and content
  const title = await page.title();
  console.log('Page title:', title);

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Body text preview:', bodyText);

  // Wait for reviews to load
  await new Promise(r => setTimeout(r, 4000));

  // Scroll to load more reviews
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 800));
  }

  // Try clicking "More reviews" buttons
  try {
    const moreBtn = await page.$('[aria-label*="více"], [data-value*="more"], button[jsaction*="review"]');
    if (moreBtn) { await moreBtn.click(); await new Promise(r => setTimeout(r, 2000)); }
  } catch {}

  // Expand all "Více" (More) buttons in reviews
  const expandButtons = await page.$$('button[aria-label*="Více"], button[jsaction*="expand"], .w8nwRe, .MyEned');
  for (const btn of expandButtons) {
    try { await btn.click(); await new Promise(r => setTimeout(r, 200)); } catch {}
  }

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '../reviews-debug2.png', fullPage: true });

  // Extract reviews
  const reviews = await page.evaluate(() => {
    const results = [];

    // Try multiple selectors for Google Maps reviews
    const reviewSelectors = [
      '.jftiEf',
      '[data-review-id]',
      '.WMbnJf',
      '.GHT2ce',
      '[class*="review"]',
      '.d4r55',
      '.MyEned'
    ];

    let reviewElements = [];
    for (const sel of reviewSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        console.log('Found reviews with selector:', sel, els.length);
        reviewElements = Array.from(els);
        break;
      }
    }

    for (const el of reviewElements) {
      try {
        const text = el.querySelector('.wiI7pd, .review-full-text, [class*="text"]')?.innerText?.trim()
          || el.innerText.trim();
        const author = el.querySelector('.d4r55, .section-review-title, [class*="author"], .DU9Pgb')?.innerText?.trim()
          || null;
        const rating = el.querySelector('[aria-label*="hvězd"], [aria-label*="star"], .kvMYJc')?.getAttribute('aria-label')
          || null;
        const date = el.querySelector('.rsqaWe, .section-review-publish-date, [class*="date"]')?.innerText?.trim()
          || null;

        if (text && text.length > 5) {
          results.push({ author, rating, date, text });
        }
      } catch {}
    }

    // Also try getting all text blocks that look like reviews
    if (results.length === 0) {
      // Dump full page structure for debugging
      const allText = document.body.innerText;
      return { debug: true, allText: allText.substring(0, 5000), url: window.location.href };
    }

    return results;
  });

  console.log('\nReviews found:', JSON.stringify(reviews, null, 2));

  await browser.close();
  return reviews;
}

scrapeReviews().catch(console.error);
