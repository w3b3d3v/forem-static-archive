const fs = require('fs');
const csv = require('csv-parser');

fs.createReadStream('data/forem_articles_with_local_images.csv')
  .pipe(csv())
  .on('data', (row) => {
    if (row.slug === 'aplicativo-descentralizado-de-staking-com-solidity-e-react-em-40-minutos-3d4h') {
      const idx = row.body_markdown.indexOf('k9d03n9cgl38j6i2q2ne');
      console.log('Markdown context around S3 URL:');
      console.log(row.body_markdown.substring(idx - 100, idx + 150));
      console.log('\n---\n');

      // Check if it's in an HTML img tag already
      const htmlIdx = row.body_markdown.indexOf('<img');
      if (htmlIdx !== -1 && htmlIdx < idx) {
        console.log('This appears to be inside HTML, not markdown');
        console.log('HTML context:');
        console.log(row.body_markdown.substring(htmlIdx, htmlIdx + 300));
      }

      process.exit(0);
    }
  });
