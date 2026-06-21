import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath: '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  headless: true
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/freetranslator-v2.1.html', { waitUntil: 'networkidle2', timeout: 15000 });

// Run engine + decide so everything lights up
await page.evaluate(() => {
  for(let i=0; i<12; i++) engineStep();
});
await new Promise(r => setTimeout(r, 800));
// Trigger decision matrix
await page.click('#decideBtn').catch(()=>{});
await new Promise(r => setTimeout(r, 1200));

// Full page wide shot
await page.screenshot({ path: '/tmp/ft_wide.png', clip: { x:0, y:0, width:1680, height:1000 } });

// Header + left + center only (left 2/3)
await page.screenshot({ path: '/tmp/ft_left2.png', clip: { x:0, y:0, width:1100, height:1000 } });

// Right panel only
await page.screenshot({ path: '/tmp/ft_right2.png', clip: { x:1100, y:0, width:580, height:1000 } });

// Decision matrix strip (full width, bottom section)
const sect = await page.$('section');
if(sect) {
  const box = await sect.boundingBox();
  await page.screenshot({ path: '/tmp/ft_matrix2.png', clip: { x:0, y:box.y, width:1680, height:Math.min(500, box.height) }});
}
console.log('done');
await browser.close();
