import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath: '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  headless: true
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 940, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/panorama', { waitUntil: 'networkidle2', timeout: 20000 });

// Wait for Three.js to render a few frames
await new Promise(r => setTimeout(r, 3000));

await page.screenshot({ path: '/tmp/panorama_full.png' });

// Simulate a few drag steps to show rotation
await page.evaluate(() => {
  // advance step counter to animate spirals
  // (state.step is internal so just wait)
});
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: '/tmp/panorama_full2.png' });

console.log('done');
await browser.close();
