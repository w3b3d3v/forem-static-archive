const fs = require('fs');
const csv = require('csv-parser');

fs.createReadStream('data/forem_articles_with_local_images.csv')
  .pipe(csv())
  .on('data', (row) => {
    if (row.slug === 'como-criar-sua-propria-memecoin-na-rede-solana-um-guia-passo-a-passo-4l56') {
      const md = row.body_markdown;
      const s3Matches = md.match(/web3dev-forem-production\.s3\.amazonaws\.com[^\)\s]+/g);
      console.log('S3 URLs found:', s3Matches ? s3Matches.length : 0);
      if (s3Matches) {
        console.log('First 3 matches:');
        s3Matches.slice(0, 3).forEach((m, i) => {
          console.log(`  ${i+1}. ${m}`);
          // Show context around the match
          const idx = md.indexOf(m);
          console.log(`     Context: ...${md.substring(idx-20, idx+m.length+20)}...`);
        });
      }
      process.exit(0);
    }
  });
