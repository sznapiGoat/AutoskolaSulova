import puppeteer from 'puppeteer';
import fs from 'fs';

const MAPS_URL = 'https://www.google.com/maps/place/Auto%C5%A1kola+Barbora+%C5%A0%C5%AFlov%C3%A1/@49.7447514,13.5969,15z/data=!4m6!3m5!1s0x470af4e76f68e4ad:0x5e7b13c41a3cbef1!8m2!3d49.7447514!4d13.5969!16s%2Fg%2F11f264606_?hl=cs&entry=ttu';

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=cs-CZ',
      '--window-size=1280,900'
    ]
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Opening Google Maps place...');
  await page.goto(MAPS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Accept cookies
  try {
    const acceptBtn = await page.$('button[aria-label*="Přijmout"], button[aria-label*="Accept all"], form[action*="consent"] button:last-child');
    if (acceptBtn) { await acceptBtn.click(); await new Promise(r => setTimeout(r, 2000)); console.log('Accepted cookies'); }
  } catch {}

  console.log('URL:', page.url());

  // Click Reviews tab
  await new Promise(r => setTimeout(r, 2000));
  const tabs = await page.$$('button[role="tab"], [aria-label*="Recenze"]');
  console.log('Tabs found:', tabs.length);
  for (const tab of tabs) {
    const label = await page.evaluate(el => el.getAttribute('aria-label') || el.innerText, tab);
    console.log(' tab:', label);
    if (label && label.toLowerCase().includes('recenze')) {
      await tab.click();
      await new Promise(r => setTimeout(r, 2000));
      console.log('Clicked reviews tab');
      break;
    }
  }

  // Sort by newest (optional — default is "most relevant")
  // Scroll reviews panel
  console.log('Scrolling to load all reviews...');
  for (let i = 0; i < 30; i++) {
    const scrolled = await page.evaluate(() => {
      // The reviews panel is a scrollable div
      const scrollable = document.querySelector('[role="feed"], .m6QErb.DxyBCb, .m6QErb[aria-label]');
      if (scrollable) {
        scrollable.scrollTop += 600;
        return { scrollTop: scrollable.scrollTop, scrollHeight: scrollable.scrollHeight, found: true };
      }
      window.scrollBy(0, 600);
      return { found: false };
    });
    await new Promise(r => setTimeout(r, 700));
    if (i % 5 === 0) console.log(`  Scroll ${i}: ${JSON.stringify(scrolled)}`);
  }

  // Expand all "Více" (More text) buttons
  console.log('Expanding review texts...');
  let expandCount = 0;
  let tries = 0;
  while (tries < 5) {
    const btns = await page.$$('.w8nwRe, button[jsaction*="expand"]');
    if (btns.length === 0) break;
    for (const btn of btns) {
      try { await btn.click(); await new Promise(r => setTimeout(r, 100)); expandCount++; } catch {}
    }
    tries++;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`Expanded ${expandCount} review texts`);

  await new Promise(r => setTimeout(r, 1000));

  // Extract
  const reviews = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    const containers = document.querySelectorAll('.jftiEf');

    containers.forEach(el => {
      const author = el.querySelector('.d4r55')?.innerText?.trim() || null;
      const ratingEl = el.querySelector('.kvMYJc');
      const ratingLabel = ratingEl?.getAttribute('aria-label') || '';
      const stars = ratingLabel.match(/(\d)/)?.[1] ? parseInt(ratingLabel.match(/(\d)/)[1]) : null;
      const text = el.querySelector('.wiI7pd')?.innerText?.trim() || null;
      const date = el.querySelector('.rsqaWe')?.innerText?.trim() || null;

      const key = `${author}|${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ author, stars, ratingLabel, date, text });
      }
    });

    return results;
  });

  console.log(`\n=== ${reviews.length} UNIQUE REVIEWS FOUND ===`);
  reviews.forEach((r, i) => {
    console.log(`\n[${i+1}] ${r.author} — ${r.stars}★ — ${r.date}`);
    console.log(r.text || '(no text)');
  });

  fs.writeFileSync('../reviews-raw.json', JSON.stringify(reviews, null, 2), 'utf-8');
  console.log('\nSaved to reviews-raw.json');

  await browser.close();
}

main().catch(console.error);
