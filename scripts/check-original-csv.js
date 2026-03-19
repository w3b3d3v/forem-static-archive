const fs = require('fs');
const csv = require('csv-parser');

const slug = 'aplicativo-descentralizado-de-staking-com-solidity-e-react-em-40-minutos-3d4h';

fs.createReadStream('data/forem_articles_filtered_by_outdated.csv')
  .pipe(csv())
  .on('data', (row) => {
    if (row.slug === slug) {
      console.log('Found article:', row.title);
      console.log('main_image:', row.main_image);
      console.log('body_html length:', row.body_html ? row.body_html.length : 0);
      console.log('body_markdown length:', row.body_markdown ? row.body_markdown.length : 0);
      console.log('body_html contains S3:', row.body_html ? row.body_html.includes('web3dev-forem-production.s3.amazonaws.com') : false);
      process.exit(0);
    }
  })
  .on('end', () => {
    console.log('Article not found');
  });
