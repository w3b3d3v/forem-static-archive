const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const csv = require('csv-parser');
const crypto = require('crypto');

// Configuration
const DATA_DIR = path.join(__dirname, '../data');
const IMAGE_DIR = path.join(__dirname, '../public/images');
const CSV_INPUT = path.join(DATA_DIR, 'forem_articles_filtered_by_outdated.csv');
const CSV_OUTPUT = path.join(DATA_DIR, 'forem_articles_with_local_images.csv');

// Ensure image directory exists
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Extract all image URLs from HTML and Markdown content
 */
function extractImageUrls(content) {
  if (!content) return [];
  const urls = new Set();

  // HTML img tags: <img src="url">
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    urls.add(match[1]);
  }

  // Markdown images: ![alt](url) and malformed ![text(url)
  const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = mdRegex.exec(content)) !== null) {
    urls.add(match[2]);
  }

  // Malformed markdown: ![text(url) - missing closing bracket
  const malformedRegex = /!\[([^\(]*)\((https?:\/\/[^\s)]+)\)/g;
  while ((match = malformedRegex.exec(content)) !== null) {
    urls.add(match[2]);
  }

  return Array.from(urls);
}

/**
 * Generate a stable filename from URL
 */
function urlToFilename(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
  const ext = path.extname(new URL(url).pathname) || '.jpg';
  return `${hash}${ext}`;
}

/**
 * Download image from URL
 */
function downloadImage(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const timeoutId = setTimeout(() => {
      reject(new Error('Download timeout'));
    }, timeout);

    protocol.get(url, {timeout: 20000}, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        clearTimeout(timeoutId);
        return downloadImage(response.headers.location, timeout)
          .then(resolve)
          .catch(reject);
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

/**
 * Download and save a single image
 */
async function processImage(url, urlMapping) {
  // Skip if already processed
  if (urlMapping.has(url)) {
    return urlMapping.get(url);
  }

  const filename = urlToFilename(url);
  const outputPath = path.join(IMAGE_DIR, filename);
  const localPath = `/images/${filename}`;

  // Skip if file already exists
  if (fs.existsSync(outputPath)) {
    console.log(`✓ Exists: ${filename}`);
    urlMapping.set(url, localPath);
    return localPath;
  }

  try {
    console.log(`⬇ Downloading: ${url.substring(0, 70)}...`);
    const buffer = await downloadImage(url);
    fs.writeFileSync(outputPath, buffer);
    console.log(`✓ Saved: ${filename} (${Math.round(buffer.length / 1024)}KB)`);
    urlMapping.set(url, localPath);
    return localPath;
  } catch (err) {
    console.error(`✗ Failed: ${url.substring(0, 70)}... - ${err.message}`);
    urlMapping.set(url, url); // Keep original URL on failure
    return url;
  }
}

/**
 * Process images with concurrency limit
 */
async function downloadAllImages(urls, concurrency = 15) {
  const urlMapping = new Map();
  const queue = [...urls];
  let active = 0;
  let completed = 0;

  return new Promise((resolve) => {
    function processNext() {
      while (active < concurrency && queue.length > 0) {
        const url = queue.shift();
        active++;

        processImage(url, urlMapping)
          .then(() => {
            completed++;
            active--;

            if (completed % 50 === 0) {
              console.log(`Progress: ${completed}/${urls.length} images`);
            }

            processNext();
          })
          .catch(() => {
            completed++;
            active--;
            processNext();
          });
      }

      if (active === 0 && queue.length === 0) {
        resolve(urlMapping);
      }
    }

    processNext();
  });
}

/**
 * Replace image URLs in HTML and Markdown with local paths
 */
function replaceImageUrls(content, urlMapping) {
  if (!content) return content;

  let result = content;
  for (const [originalUrl, localPath] of urlMapping.entries()) {
    if (localPath !== originalUrl) {
      // Escape special regex characters in URL
      const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedUrl, 'g'), localPath);
    }
  }

  return result;
}

/**
 * Main migration function
 */
async function migrateImages() {
  console.log('\n🚀 Starting one-time image migration...\n');

  // Step 1: Load CSV and collect all image URLs
  console.log('📊 Loading CSV and extracting image URLs...');
  const articles = [];
  const allImageUrls = new Set();

  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_INPUT)
      .pipe(csv())
      .on('data', (row) => {
        articles.push(row);

        // Extract from body_html
        if (row.body_html) {
          extractImageUrls(row.body_html).forEach(url => allImageUrls.add(url));
        }

        // Extract from body_markdown
        if (row.body_markdown) {
          extractImageUrls(row.body_markdown).forEach(url => allImageUrls.add(url));
        }

        // Extract from main_image
        if (row.main_image && row.main_image.trim()) {
          allImageUrls.add(row.main_image.trim());
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`   Found ${articles.length} articles`);
  console.log(`   Found ${allImageUrls.size} unique image URLs\n`);

  // Step 2: Download all images
  console.log('🖼️  Downloading images...\n');
  const urlMapping = await downloadAllImages(Array.from(allImageUrls), 15);

  const downloaded = Array.from(urlMapping.values()).filter(v => v.startsWith('/images/')).length;
  const failed = allImageUrls.size - downloaded;

  console.log('\n=== Download Summary ===');
  console.log(`Total images: ${allImageUrls.size}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Failed/Skipped: ${failed}\n`);

  // Step 3: Update CSV with local image paths
  console.log('📝 Updating CSV with local image paths...');

  const updatedArticles = articles.map(article => {
    const updated = { ...article };

    // Update body_html
    if (updated.body_html) {
      updated.body_html = replaceImageUrls(updated.body_html, urlMapping);
    }

    // Update body_markdown
    if (updated.body_markdown) {
      updated.body_markdown = replaceImageUrls(updated.body_markdown, urlMapping);
    }

    // Update main_image
    if (updated.main_image && urlMapping.has(updated.main_image.trim())) {
      updated.main_image = urlMapping.get(updated.main_image.trim());
    }

    return updated;
  });

  // Step 4: Write updated CSV
  console.log('💾 Writing updated CSV...');

  if (updatedArticles.length === 0) {
    console.error('❌ No articles to write!');
    return;
  }

  const headers = Object.keys(updatedArticles[0]);
  const csvContent = [
    headers.join(','),
    ...updatedArticles.map(article =>
      headers.map(header => {
        const value = article[header] || '';
        // Escape CSV values that contain commas, quotes, or newlines
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    )
  ].join('\n');

  fs.writeFileSync(CSV_OUTPUT, csvContent);
  console.log(`   ✅ Written to: ${CSV_OUTPUT}\n`);

  // Summary
  const imageDir = fs.readdirSync(IMAGE_DIR);
  const totalSize = imageDir.reduce((sum, file) => {
    const stats = fs.statSync(path.join(IMAGE_DIR, file));
    return sum + stats.size;
  }, 0);

  console.log('✨ Migration Complete!\n');
  console.log('📊 Final Summary:');
  console.log(`   - Articles processed: ${articles.length}`);
  console.log(`   - Images downloaded: ${downloaded}`);
  console.log(`   - Total image size: ${Math.round(totalSize / 1024 / 1024)}MB`);
  console.log(`   - Image directory: public/images/`);
  console.log(`   - Original CSV: ${path.basename(CSV_INPUT)} (PRESERVED)`);
  console.log(`   - New CSV with local paths: ${path.basename(CSV_OUTPUT)}\n`);
  console.log('🎯 Next steps:');
  console.log('   1. Update scripts/build.js to use the new CSV file');
  console.log('   2. Run "npm run build" to generate static site');
}

// Run migration
migrateImages().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
