const fs = require('fs');
const csv = require('csv-parser');

const slug = 'como-criar-sua-propria-memecoin-na-rede-solana-um-guia-passo-a-passo-4l56';

fs.createReadStream('data/forem_articles_with_local_images.csv')
  .pipe(csv())
  .on('data', (row) => {
    if (row.slug === slug) {
      console.log('Found article:', row.title);
      console.log('main_image:', row.main_image);
      console.log('body_html length:', row.body_html ? row.body_html.length : 0);
      console.log('body_markdown length:', row.body_markdown ? row.body_markdown.length : 0);
      console.log('body_markdown contains S3:', row.body_markdown ? row.body_markdown.includes('web3dev-forem-production.s3.amazonaws.com') : false);
      console.log('body_markdown contains /images/:', row.body_markdown ? row.body_markdown.includes('/images/') : false);
      console.log('main_image is local:', row.main_image.startsWith('/images/'));
      process.exit(0);
    }
  })
  .on('end', () => {
    console.log('Article not found');
  });
