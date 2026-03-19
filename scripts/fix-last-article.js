const fs = require('fs');
const csv = require('csv-parser');

const articles = [];
const CSV_INPUT = 'data/forem_articles_with_local_images.csv';
const CSV_OUTPUT = 'data/forem_articles_with_local_images_fixed.csv';

fs.createReadStream(CSV_INPUT)
  .pipe(csv())
  .on('data', (row) => {
    // Fix the specific article
    if (row.slug === 'aplicativo-descentralizado-de-staking-com-solidity-e-react-em-40-minutos-3d4h') {
      console.log('Found problematic article, fixing...');

      // Replace the S3 URL with local path
      if (row.body_markdown) {
        const before = row.body_markdown.includes('k9d03n9cgl38j6i2q2ne');
        row.body_markdown = row.body_markdown.replace(
          /https:\/\/web3dev-forem-production\.s3\.amazonaws\.com\/uploads\/articles\/k9d03n9cgl38j6i2q2ne\.png/g,
          '/images/k9d03n9cgl38j6i2q2ne.png'
        );
        const after = row.body_markdown.includes('k9d03n9cgl38j6i2q2ne');
        console.log('Before had S3:', before);
        console.log('After has S3:', after);
      }
    }

    articles.push(row);
  })
  .on('end', () => {
    console.log(`\nProcessed ${articles.length} articles`);
    console.log('Writing fixed CSV...');

    const headers = Object.keys(articles[0]);
    const csvContent = [
      headers.join(','),
      ...articles.map(article =>
        headers.map(header => {
          const value = article[header] || '';
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      )
    ].join('\n');

    fs.writeFileSync(CSV_OUTPUT, csvContent);
    fs.renameSync(CSV_OUTPUT, CSV_INPUT);

    console.log('✅ Fixed and saved');
  });
