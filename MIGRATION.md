# Image Migration Guide

## One-Time Migration Process

This is a **one-time migration** to download all images from S3/CDN and create a new CSV with local image paths.

### Steps

**1. Run the migration script:**

```bash
npm run migrate-images
```

This will:
- Read `data/forem_articles_filtered_by_outdated.csv` (ORIGINAL PRESERVED)
- Extract all image URLs from articles
- Download ~3,972 unique images to `public/images/`
- Create NEW CSV: `data/forem_articles_with_local_images.csv`

**Estimated time:** 15-30 minutes (depends on network speed)

**2. After migration completes, build the site:**

```bash
npm run build
```

The build script automatically detects and uses the new CSV with local paths.

**3. Test locally:**

```bash
npm run serve
```

### What Gets Created

**Original CSV (PRESERVED):**
```
data/forem_articles_filtered_by_outdated.csv
```
Contains original S3 URLs - **never modified**

**New CSV (CREATED):**
```
data/forem_articles_with_local_images.csv
```
Contains local `/images/` paths

**Example change:**

Original:
```csv
body_html: "<img src='https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/abc123.png'>"
main_image: "https://web3dev-forem-production.s3.amazonaws.com/uploads/articles/cover.png"
```

Migrated:
```csv
body_html: "<img src='/images/a3740cb422d7.png'>"
main_image: "/images/c931c409dd98.png"
```

### Files Created

- `public/images/*.png` - Downloaded images (~3,972 files)
- `data/forem_articles_with_local_images.csv` - New CSV with local paths

### Files Preserved

- `data/forem_articles_filtered_by_outdated.csv` - Original CSV (untouched)
- All other data files remain unchanged

### Safety

- **Original CSV preserved:** Never modified, always available for reference
- **Error handling:** Failed downloads keep original URLs (graceful degradation)
- **Idempotent:** Safe to re-run - existing images are skipped
- **Automatic fallback:** Build works with or without migration

### Build Behavior

The build script (`npm run build`) automatically:

1. Checks if `forem_articles_with_local_images.csv` exists
2. **If yes:** Uses migrated CSV with local images
3. **If no:** Uses original CSV with S3 URLs (still works)

You'll see this message during build:
```
✓ Using migrated CSV with local images
```

Or if migration hasn't run:
```
⚠ Using original CSV (run "npm run migrate-images" first to use local images)
```

### Migration Summary Output

After completion, you'll see:
```
✨ Migration Complete!

📊 Final Summary:
   - Articles processed: 1589
   - Images downloaded: 3845
   - Total image size: 487MB
   - Image directory: public/images/
   - Original CSV: forem_articles_filtered_by_outdated.csv (PRESERVED)
   - New CSV with local paths: forem_articles_with_local_images.csv

🎯 Next steps:
   1. Update scripts/build.js to use the new CSV file
   2. Run "npm run build" to generate static site
```

### Re-running Migration

If migration is interrupted or you want to re-download:

```bash
# Option 1: Delete new CSV to start fresh
rm data/forem_articles_with_local_images.csv
npm run migrate-images

# Option 2: Keep images, only re-process CSV
# (Existing images in public/images/ are skipped)
npm run migrate-images
```

### Notes

- **Run once:** This is not part of the regular build process
- **Original preserved:** S3 URLs always available in original CSV
- **Commit both:** Commit both CSV files and `public/images/` to repo
- **Optional:** After migration, you can remove `sharp` from dependencies if desired
- **Backwards compatible:** Build works before and after migration
