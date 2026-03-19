const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../public');

let totalHtmlFiles = 0;
let filesWithS3Urls = [];
let totalS3Urls = 0;
let totalLocalImages = 0;

/**
 * Recursively find all HTML files
 */
function findHtmlFiles(dir) {
  const files = fs.readdirSync(dir);
  let htmlFiles = [];

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      htmlFiles = htmlFiles.concat(findHtmlFiles(filePath));
    } else if (file.endsWith('.html')) {
      htmlFiles.push(filePath);
    }
  });

  return htmlFiles;
}

/**
 * Check a single HTML file for S3 URLs
 */
function checkHtmlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = filePath.replace(PUBLIC_DIR + '/', '');

  // Find all S3 URLs
  const s3Regex = /web3dev-forem-production\.s3\.amazonaws\.com[^\s"'<>]*/g;
  const s3Matches = content.match(s3Regex);

  // Find local image references
  const localImageRegex = /src=["']\/images\/[^"']+["']/g;
  const localMatches = content.match(localImageRegex);

  const s3Count = s3Matches ? s3Matches.length : 0;
  const localCount = localMatches ? localMatches.length : 0;

  if (s3Count > 0) {
    filesWithS3Urls.push({
      path: relativePath,
      s3Count: s3Count,
      localCount: localCount,
      urls: s3Matches
    });
    totalS3Urls += s3Count;
  }

  totalLocalImages += localCount;
}

console.log('🔍 Scanning all HTML files for S3 URLs...\n');

const htmlFiles = findHtmlFiles(PUBLIC_DIR);
totalHtmlFiles = htmlFiles.length;

console.log(`Found ${totalHtmlFiles} HTML files to check\n`);

htmlFiles.forEach((file, index) => {
  checkHtmlFile(file);
  if ((index + 1) % 100 === 0) {
    console.log(`Checked ${index + 1}/${totalHtmlFiles} files...`);
  }
});

console.log(`\n✅ Scan complete!\n`);

console.log('=== Summary ===');
console.log(`Total HTML files: ${totalHtmlFiles}`);
console.log(`Files with S3 URLs: ${filesWithS3Urls.length}`);
console.log(`Total S3 URLs found: ${totalS3Urls}`);
console.log(`Total local images: ${totalLocalImages}`);
console.log('');

if (filesWithS3Urls.length > 0) {
  console.log('=== Files with S3 URLs ===\n');

  // Sort by S3 count descending
  filesWithS3Urls.sort((a, b) => b.s3Count - a.s3Count);

  filesWithS3Urls.forEach((file, index) => {
    console.log(`${index + 1}. ${file.path}`);
    console.log(`   S3 URLs: ${file.s3Count}, Local images: ${file.localCount}`);
    console.log(`   URLs:`);
    file.urls.slice(0, 3).forEach(url => {
      console.log(`     - ${url}`);
    });
    if (file.urls.length > 3) {
      console.log(`     ... and ${file.urls.length - 3} more`);
    }
    console.log('');
  });

  console.log('\n❌ VERIFICATION FAILED');
  console.log(`${filesWithS3Urls.length} files still have S3 URLs`);
  console.log(`Run migration again or check these specific articles`);
} else {
  console.log('✅ VERIFICATION PASSED');
  console.log('All HTML files use local images only!');
}

console.log('\n=== Statistics ===');
console.log(`Migration success rate: ${((totalLocalImages / (totalLocalImages + totalS3Urls)) * 100).toFixed(2)}%`);
