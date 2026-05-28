import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const BASE_URL = 'https://autoskolasulova9.webnode.cz/';
const OUTPUT_FILE = '../scraped-content.json';
const IMAGES_DIR = '../public/images';

const SUBPAGES = [
  { url: 'https://autoskolasulova9.webnode.cz/', label: 'homepage' },
  { url: 'https://autoskolasulova9.webnode.cz/o-nas/', label: 'o-nas' },
  { url: 'https://autoskolasulova9.webnode.cz/diskografie/', label: 'cenik' },
  { url: 'https://autoskolasulova9.webnode.cz/kontakt/', label: 'kontakt' },
  { url: 'https://autoskolasulova9.webnode.cz/fotogalerie/', label: 'fotogalerie' },
  { url: 'https://autoskolasulova9.webnode.cz/prihlaska/', label: 'prihlaska' },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        downloadImage(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => {
      try { fs.unlink(destPath, () => {}); } catch {}
      reject(err);
    });
  });
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/á/g, 'a').replace(/č/g, 'c').replace(/ď/g, 'd')
    .replace(/é/g, 'e').replace(/ě/g, 'e').replace(/í/g, 'i')
    .replace(/ň/g, 'n').replace(/ó/g, 'o').replace(/ř/g, 'r')
    .replace(/š/g, 's').replace(/ť/g, 't').replace(/ú/g, 'u')
    .replace(/ů/g, 'u').replace(/ý/g, 'y').replace(/ž/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60) || 'image';
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
      setTimeout(() => { clearInterval(timer); resolve(); }, 8000);
    });
  });
}

async function scrapePage(browser, url, label) {
  console.log(`\n--- Scraping: ${url} [${label}] ---`);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for JS to execute
    await new Promise(r => setTimeout(r, 3000));
    // Scroll to trigger lazy loading
    await autoScroll(page);
    await new Promise(r => setTimeout(r, 2000));

    const data = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerText.trim() : null;
      };
      const getAllText = (sel) =>
        Array.from(document.querySelectorAll(sel))
          .map(el => el.innerText.trim())
          .filter(Boolean);

      const pageTitle = document.title;
      const metaDesc = document.querySelector('meta[name="description"]')?.content || null;

      const h1 = getAllText('h1');
      const h2 = getAllText('h2');
      const h3 = getAllText('h3');
      const h4 = getAllText('h4');

      const paragraphs = getAllText('p').filter(t => t.length > 5);

      // All links on the page
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.href
      })).filter(l => l.text);

      // Nav links specifically
      const navLinks = Array.from(document.querySelectorAll(
        'nav a, header a, [class*="menu"] a, [class*="nav"] a, [id*="menu"] a, [class*="header"] a'
      )).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(l => l.text && l.href !== '#');

      // Images
      const images = Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src,
        alt: img.alt || null,
        dataSrc: img.getAttribute('data-src'),
        width: img.naturalWidth,
        height: img.naturalHeight,
        className: img.className
      })).filter(img => img.src && !img.src.startsWith('data:'));

      // Background images from CSS
      const bgImages = [];
      document.querySelectorAll('[style*="background-image"]').forEach(el => {
        const match = el.style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (match) bgImages.push({ src: match[1], type: 'background', element: el.tagName });
      });

      // Phone numbers
      const bodyText = document.body.innerText;
      const phoneMatches = bodyText.match(/(?:\+420[\s\-]?)?[0-9]{3}[\s\-]?[0-9]{3}[\s\-]?[0-9]{3}/g) || [];
      const phones = [...new Set(phoneMatches.map(p => p.replace(/[\s\-]/g, '')).filter(p => p.length >= 9))];

      // Emails
      const emailMatches = bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
      const emails = [...new Set(emailMatches.filter(e => !e.includes('webnode') && !e.includes('example')))];

      // IČO / DIČ
      const icoMatch = bodyText.match(/IČO?[:\s]+(\d{8})/i);
      const dicMatch = bodyText.match(/DIČ[:\s]+(CZ\d{8,10})/i);
      const ico = icoMatch ? icoMatch[1] : null;
      const dic = dicMatch ? dicMatch[1] : null;

      // Prices
      const priceMatches = bodyText.match(/\d[\d\s]*(?:Kč|kč|,-|,--)/g) || [];
      const prices = [...new Set(priceMatches.map(p => p.trim()))];

      // Tables
      const tables = Array.from(document.querySelectorAll('table')).map(table => {
        const rows = Array.from(table.querySelectorAll('tr')).map(row =>
          Array.from(row.querySelectorAll('td, th')).map(cell => cell.innerText.trim())
        ).filter(row => row.some(cell => cell));
        return rows;
      }).filter(t => t.length > 0);

      // List items
      const listItems = Array.from(document.querySelectorAll('li')).map(li => li.innerText.trim()).filter(t => t.length > 3);

      // Google Maps
      const mapIframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.src,
        width: f.width,
        height: f.height
      })).filter(f => f.src && (f.src.includes('google') || f.src.includes('maps')));

      // Social media links
      const socialLinks = Array.from(document.querySelectorAll('a')).filter(a =>
        a.href.match(/facebook|instagram|youtube|twitter|tiktok|linkedin/i)
      ).map(a => ({ platform: a.href.match(/facebook|instagram|youtube|twitter|tiktok|linkedin/i)?.[0], href: a.href }));

      // Content sections with their structure
      const sections = Array.from(document.querySelectorAll('section, article, [class*="section"], [class*="content"], [class*="block"], [class*="row"], [class*="col"]'))
        .map(el => ({
          tag: el.tagName,
          id: el.id || null,
          class: el.className.substring(0, 100),
          text: el.innerText.trim().substring(0, 3000),
          headings: Array.from(el.querySelectorAll('h1,h2,h3,h4')).map(h => h.innerText.trim()),
          paragraphs: Array.from(el.querySelectorAll('p')).map(p => p.innerText.trim()).filter(Boolean)
        }))
        .filter(s => s.text.length > 20);

      const fullText = document.body.innerText;

      return {
        pageTitle, metaDesc,
        h1, h2, h3, h4,
        paragraphs, listItems,
        navLinks, allLinks,
        images, bgImages,
        phones, emails, ico, dic,
        prices, tables,
        mapIframes, socialLinks,
        sections,
        fullText: fullText.substring(0, 15000)
      };
    });

    console.log(`  Title: ${data.pageTitle}`);
    console.log(`  H1: ${data.h1.join(' | ') || '(none)'}`);
    console.log(`  H2: ${data.h2.slice(0, 5).join(' | ') || '(none)'}`);
    console.log(`  H3: ${data.h3.slice(0, 5).join(' | ') || '(none)'}`);
    console.log(`  Phones: ${data.phones.join(', ') || '(none)'}`);
    console.log(`  Emails: ${data.emails.join(', ') || '(none)'}`);
    console.log(`  IČO: ${data.ico || '(none)'}`);
    console.log(`  Images: ${data.images.length}, BG imgs: ${data.bgImages.length}`);
    console.log(`  Tables: ${data.tables.length}`);
    console.log(`  Maps: ${data.mapIframes.length}`);
    console.log(`  Social: ${data.socialLinks.map(s => s.href).join(', ') || '(none)'}`);
    console.log(`  Prices: ${data.prices.join(', ') || '(none)'}`);
    console.log('  --- Full text preview ---');
    console.log(data.fullText.substring(0, 800));
    console.log('  ---');

    await page.close();
    return data;
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
    await page.close();
    return null;
  }
}

async function main() {
  ensureDir(IMAGES_DIR);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security']
  });

  const scrapedPages = {};

  try {
    for (const { url, label } of SUBPAGES) {
      const data = await scrapePage(browser, url, label);
      if (data) scrapedPages[label] = { url, ...data };
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally {
    await browser.close();
  }

  // === Download images ===
  console.log('\n=== Downloading images ===');
  const allImageUrls = new Map();

  for (const [label, pageData] of Object.entries(scrapedPages)) {
    for (const img of (pageData.images || [])) {
      if (img.src && !allImageUrls.has(img.src)) allImageUrls.set(img.src, { ...img, page: label });
    }
    for (const img of (pageData.bgImages || [])) {
      if (img.src && !allImageUrls.has(img.src)) allImageUrls.set(img.src, { ...img, page: label });
    }
  }

  const downloadedImages = [];
  let idx = 0;
  for (const [src, img] of allImageUrls) {
    if (idx >= 80) { console.log('(image limit 80 reached)'); break; }
    try {
      const rawSrc = src.split('?')[0];
      const ext = rawSrc.split('.').pop().toLowerCase();
      const validExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ? ext : 'jpg';
      const altSlug = img.alt ? slugify(img.alt) : `foto-${idx + 1}`;
      const filename = `${altSlug}.${validExt}`;
      const destPath = path.join(IMAGES_DIR, filename);

      if (!fs.existsSync(destPath)) {
        await downloadImage(src, destPath);
        const stat = fs.statSync(destPath);
        if (stat.size < 500) { fs.unlinkSync(destPath); throw new Error('too small / likely error page'); }
        console.log(`  ✓ ${filename} (${stat.size} bytes)`);
      } else {
        console.log(`  = ${filename} (cached)`);
      }
      downloadedImages.push({ src, alt: img.alt || null, localPath: `/images/${filename}`, filename, page: img.page });
    } catch (err) {
      console.warn(`  ✗ ${src.substring(0, 60)}: ${err.message}`);
      downloadedImages.push({ src, alt: img.alt || null, localPath: null, filename: null, page: img.page });
    }
    idx++;
  }

  // === Compile output ===
  const homepage = scrapedPages['homepage'];
  const cenik = scrapedPages['cenik'];
  const oNas = scrapedPages['o-nas'];
  const kontakt = scrapedPages['kontakt'];

  const allPhones = [...new Set(Object.values(scrapedPages).flatMap(p => p.phones || []))];
  const allEmails = [...new Set(Object.values(scrapedPages).flatMap(p => p.emails || []))];
  const allPrices = [...new Set(Object.values(scrapedPages).flatMap(p => p.prices || []))];
  const allTables = Object.values(scrapedPages).flatMap(p => p.tables || []);
  const allMaps = Object.values(scrapedPages).flatMap(p => p.mapIframes || []);
  const allSocial = [...new Set(Object.values(scrapedPages).flatMap(p => p.socialLinks || []).map(s => s.href))];
  const ico = Object.values(scrapedPages).find(p => p.ico)?.ico || null;
  const dic = Object.values(scrapedPages).find(p => p.dic)?.dic || null;

  // Build the structured output
  const output = {
    _meta: {
      scrapedAt: new Date().toISOString(),
      sourceUrl: BASE_URL,
      pagesScraped: Object.keys(scrapedPages),
      note: "Zero hallucination policy. null = not found on source. All data verbatim from site."
    },
    business: {
      name: "Autoškola Barbora Šůlová",
      legalName: null,
      tagline: null,
      ico,
      dic,
      founded: null,
    },
    contact: {
      phones: allPhones.length ? allPhones : null,
      emails: allEmails.length ? allEmails : null,
      address: null,
      region: null,
      gps: null,
      openingHours: null,
      googleMapsEmbed: allMaps.length ? allMaps[0].src : null,
    },
    social: allSocial.length ? allSocial : null,
    navigation: homepage?.navLinks?.filter(l => l.href && !l.href.includes('#')) || null,
    pages: Object.fromEntries(
      Object.entries(scrapedPages).map(([label, data]) => [label, {
        url: data.url,
        title: data.pageTitle,
        metaDesc: data.metaDesc,
        h1: data.h1,
        h2: data.h2,
        h3: data.h3,
        h4: data.h4,
        paragraphs: data.paragraphs,
        listItems: data.listItems,
        tables: data.tables,
        prices: data.prices,
        sections: data.sections,
        fullText: data.fullText,
      }])
    ),
    services: null,
    pricing: {
      rawPriceStrings: allPrices.length ? allPrices : null,
      tables: allTables,
    },
    instructors: null,
    testimonials: null,
    certifications: null,
    images: downloadedImages,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ scraped-content.json saved`);
  console.log('\n======= FINAL SUMMARY =======');
  console.log('Pages scraped:', Object.keys(scrapedPages));
  console.log('\n--- PER PAGE FULL TEXT ---');
  for (const [label, data] of Object.entries(scrapedPages)) {
    console.log(`\n[${label.toUpperCase()}]`);
    console.log(data.fullText?.substring(0, 1200) || '(empty)');
    console.log('...');
  }
}

main().catch(console.error);
