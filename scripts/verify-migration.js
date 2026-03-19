const fs = require('fs');
const csv = require('csv-parser');

let totalArticles = 0;
let articlesWithLocalMainImage = 0;
let articlesWithS3MainImage = 0;
let articlesWithLocalBodyImages = 0;
let articlesWithS3BodyImages = 0;

fs.createReadStream('data/forem_articles_with_local_images.csv')
  .pipe(csv())
  .on('data', (row) => {
    totalArticles++;

    // Check main_image
    if (row.main_image) {
      if (row.main_image.startsWith('/images/')) {
        articlesWithLocalMainImage++;
      } else if (row.main_image.includes('s3.amazonaws.com')) {
        articlesWithS3MainImage++;
      }
    }

    // Check body_html
    if (row.body_html) {
      if (row.body_html.includes('/images/')) {
        articlesWithLocalBodyImages++;
      }
      if (row.body_html.includes('s3.amazonaws.com')) {
        articlesWithS3BodyImages++;
      }
    }
  })
  .on('end', () => {
    console.log('\n=== Migration Verification ===\n');
    console.log(`Total articles: ${totalArticles}`);
    console.log('');
    console.log('Main Images:');
    console.log(`  Local (/images/): ${articlesWithLocalMainImage}`);
    console.log(`  S3 URLs: ${articlesWithS3MainImage}`);
    console.log('');
    console.log('Body Images:');
    console.log(`  Articles with /images/: ${articlesWithLocalBodyImages}`);
    console.log(`  Articles with S3 URLs: ${articlesWithS3BodyImages}`);
    console.log('');

    if (articlesWithS3MainImage > 0 || articlesWithS3BodyImages > 0) {
      console.log('❌ MIGRATION FAILED - S3 URLs still present!');
    } else {
      console.log('✅ Migration successful - all images local');
    }
  });
