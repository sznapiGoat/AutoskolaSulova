import puppeteer from 'puppeteer';

// Using the kgmid from the redirect: /g/11f264606_
// Trying direct Google Maps URL
const MAPS_URL = 'https://www.google.com/maps/search/Auto%C5%A1kola+Barbora+%C5%A0%C5%AFlov%C3%A1+Rokycany/@49.7447,13.5969,15z';

async function main() {
  const browser = await puppeteer.launch({
    headless: false, // use visible browser to avoid CAPTCHA
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=cs-CZ'
    ]
  });

  const page = await browser.newPage();

  // Mask puppeteer fingerprint
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Opening Google Maps...');
  await page.goto(MAPS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  // Accept cookies if present
  try {
    const acceptBtn = await page.$('button[aria-label*="Accept"], button[aria-label*="Přijmout"], form[action*="consent"] button');
    if (acceptBtn) { await acceptBtn.click(); await new Promise(r => setTimeout(r, 2000)); }
  } catch {}

  // Click on the first result
  try {
    const result = await page.$('.hfpxzc, [data-value="Autoškola Barbora Šůlová"]');
    if (result) { await result.click(); await new Promise(r => setTimeout(r, 3000)); }
  } catch {}

  // Click Reviews tab
  try {
    const reviewTab = await page.$('[aria-label*="Recenze"], [data-tab-index="1"], button[jsaction*="review"]');
    if (reviewTab) { await reviewTab.click(); await new Promise(r => setTimeout(r, 2000)); }
  } catch {}

  // Scroll reviews panel to load all
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => {
      const panel = document.querySelector('.m6QErb[aria-label], .DxyBCb, [role="main"]');
      if (panel) panel.scrollTop += 500;
      else window.scrollBy(0, 500);
    });
    await new Promise(r => setTimeout(r, 600));
  }

  // Expand all "More" buttons
  const moreBtns = await page.$$('.w8nwRe, button[aria-label*="Více"], .osrp-blk');
  for (const btn of moreBtns) {
    try { await btn.click(); await new Promise(r => setTimeout(r, 150)); } catch {}
  }

  await new Promise(r => setTimeout(r, 1000));

  const reviews = await page.evaluate(() => {
    const items = [];
    // Google Maps review containers
    const containers = document.querySelectorAll('.jftiEf, .GHT2ce, [data-review-id]');
    containers.forEach(el => {
      const author = el.querySelector('.d4r55')?.innerText?.trim() || null;
      const ratingEl = el.querySelector('.kvMYJc');
      const rating = ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.innerText)?.trim() : null;
      const text = el.querySelector('.wiI7pd')?.innerText?.trim() || null;
      const date = el.querySelector('.rsqaWe')?.innerText?.trim() || null;
      if (author || text) items.push({ author, rating, date, text });
    });

    if (items.length === 0) {
      return { debug: true, bodySnippet: document.body.innerText.substring(0, 2000), url: window.location.href };
    }
    return items;
  });

  console.log('\n=== REVIEWS ===');
  console.log(JSON.stringify(reviews, null, 2));

  await page.screenshot({ path: '../maps-screenshot.png', fullPage: false });
  console.log('\nScreenshot saved to maps-screenshot.png');

  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
}

main().catch(console.error);
