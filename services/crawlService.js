const puppeteer = require('puppeteer-core');
const os = require('os');

// State variables
let browser = null;
let page = null;

// Get Chrome executable path based on operating system
function getChromePath() {
  const platform = os.platform();
  if (platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else if (platform === 'linux') {
    // Try common Linux paths
    const linuxPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    ];
    return linuxPaths[0]; // Default to first path
  }
  throw new Error('Unsupported operating system');
}

// Initialize the scraper
async function initializeScraper() {
  const chromePath = getChromePath();
  const isLinux = os.platform() === 'linux';

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(isLinux ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080'
      ] : [])
    ]
  });

  page = await browser.newPage();
  await page.goto('https://1.bot/Lottery/MienBacVIP45', { waitUntil: 'networkidle2' });

  await scrollPageToBottom(page);

  console.log('Scraper initialized successfully');
}

async function scrollPageToBottom(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

async function scrapeVIPLotteryResults() {
  if (!page) {
    throw new Error('Scraper has not been initialized');
  }

  try {
    await page.waitForSelector('#tableHistory tr:last-child .number', { timeout: 5000 });

    const tableData = await page.$$eval('#tableHistory tr:not(:first-child)', rows => {
      return rows.map(row => {
        const columns = row.querySelectorAll('td');
        if (columns.length >= 3) {
          const drawId = columns[0].textContent.trim();
          
          const numberCell = columns[1];
          const spans = numberCell.querySelectorAll('span.opencode');
          const numbers = Array.from(spans).map(span => span.textContent.trim());
          
          const drawTime = columns[2].textContent.trim();
          
          return {
            drawId: drawId,
            numbers: numbers,
            drawTime: drawTime
          };
        }
        return null;
      });
    });
    return tableData;
  } catch (error) {
    console.error('Error scraping lottery results:', error);
    throw error;
  }
}

module.exports = {
  initializeScraper,
  scrapeVIPLotteryResults,
};
