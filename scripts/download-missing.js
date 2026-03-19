const https = require('https');
const fs = require('fs');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, '../public/images');
const failedUrls = [
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/qm2tt8ah8q69z27lj043.jpg',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/vpbqa0q87dxqt7y3nvn9.jpg',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/hzsgerbynay9ht5y8zgg.png',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/65463pep8bmufzf68ymq.png',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/qvvbm4a6yyfk2xvvszoz.png',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/xh1o6zt43utlk2t96v0u.png',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/fvk5oin3jq9e62gca62c.png',
  'https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/k9d03n9cgl38j6i2q2ne.png'
];

function downloadImage(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Timeout')), timeout);

    https.get(url, {timeout: 20000}, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        clearTimeout(timeoutId);
        return downloadImage(response.headers.location, timeout).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        clearTimeout(timeoutId);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timeoutId);
        resolve(Buffer.concat(chunks));
      });
      response.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    }).on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

async function tryDownload(url) {
  const filename = url.split('/').pop();
  const outputPath = path.join(IMAGE_DIR, filename);

  console.log(`Trying: ${url}`);

  try {
    const buffer = await downloadImage(url);
    fs.writeFileSync(outputPath, buffer);
    console.log(`✓ Downloaded: ${filename} (${Math.round(buffer.length/1024)}KB)\n`);
    return true;
  } catch (err) {
    console.log(`✗ Failed: ${err.message}\n`);
    return false;
  }
}

async function main() {
  console.log('Attempting to download missing images...\n');

  let success = 0;
  let failed = 0;

  for (const url of failedUrls) {
    const result = await tryDownload(url);
    if (result) success++;
    else failed++;
  }

  console.log(`\nResults: ${success} downloaded, ${failed} failed`);
}

main();
