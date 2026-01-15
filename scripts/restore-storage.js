/**
 * Supabase Storage Restore from Google Cloud Storage
 * 
 * This script restores files from GCS backups to Supabase storage buckets.
 * Files are organized by club/team folders and will be restored to their original paths.
 */

import { createClient } from '@supabase/supabase-js';
import { Storage } from '@google-cloud/storage';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const BACKUP_DATE = process.env.BACKUP_DATE; // Format: YYYY-MM-DD
const BUCKETS_TO_RESTORE = process.env.BUCKETS_TO_RESTORE; // Comma-separated list, or 'all'
const DRY_RUN = process.env.DRY_RUN === 'true';
const OVERWRITE_EXISTING = process.env.OVERWRITE_EXISTING === 'true';

// All known buckets
const ALL_BUCKETS = [
  'app-ads',
  'sponsor-logos', 
  'photos',
  'chat-attachments',
  'avatars',
  'backups'
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GCS_BUCKET_NAME) {
    throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GCS_BUCKET_NAME');
  }

  console.log('='.repeat(60));
  console.log('SUPABASE STORAGE RESTORE');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuration:');
  console.log(`  Supabase URL: ${SUPABASE_URL}`);
  console.log(`  GCS Bucket: ${GCS_BUCKET_NAME}`);
  console.log(`  Backup Date: ${BACKUP_DATE || '(will list available)'}`);
  console.log(`  Buckets: ${BUCKETS_TO_RESTORE || 'all'}`);
  console.log(`  Dry Run: ${DRY_RUN}`);
  console.log(`  Overwrite Existing: ${OVERWRITE_EXISTING}`);
  console.log('');

  const gcs = new Storage();
  const gcsBucket = gcs.bucket(GCS_BUCKET_NAME);

  // If no backup date specified, list available backups
  if (!BACKUP_DATE) {
    await listAvailableBackups(gcsBucket);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify backup exists
  const backupPath = `supabase-buckets/${BACKUP_DATE}/`;
  const [backupExists] = await gcsBucket.file(backupPath).exists().catch(() => [false]);
  
  // List files to check if backup date has any files
  const [files] = await gcsBucket.getFiles({ prefix: backupPath, maxResults: 1 });
  if (files.length === 0) {
    console.error(`❌ No backup found for date: ${BACKUP_DATE}`);
    console.log('');
    await listAvailableBackups(gcsBucket);
    return;
  }

  // Determine which buckets to restore
  let bucketsToRestore = ALL_BUCKETS;
  if (BUCKETS_TO_RESTORE && BUCKETS_TO_RESTORE !== 'all') {
    bucketsToRestore = BUCKETS_TO_RESTORE.split(',').map(b => b.trim());
  }

  console.log(`Restoring buckets: ${bucketsToRestore.join(', ')}`);
  console.log('');

  // First, list all available buckets in Supabase
  const { data: availableBuckets, error: bucketsError } = await supabase.storage.listBuckets();
  
  if (bucketsError) {
    console.error('Error listing Supabase buckets:', bucketsError);
    throw bucketsError;
  }

  console.log('Available Supabase buckets:', availableBuckets.map(b => b.name).join(', '));
  console.log('');

  let totalFiles = 0;
  let totalBytes = 0;
  let skippedFiles = 0;
  let errorFiles = 0;

  for (const bucketName of bucketsToRestore) {
    console.log('-'.repeat(40));
    console.log(`Processing bucket: ${bucketName}`);
    
    // Check if bucket exists in Supabase
    const bucketExists = availableBuckets.some(b => b.name === bucketName);
    if (!bucketExists) {
      console.log(`  ⚠ Bucket "${bucketName}" does not exist in Supabase`);
      console.log(`  Creating bucket...`);
      
      if (!DRY_RUN) {
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: bucketName === 'avatars' || bucketName === 'app-ads' || bucketName === 'sponsor-logos'
        });
        
        if (createError) {
          console.error(`  ❌ Failed to create bucket: ${createError.message}`);
          continue;
        }
        console.log(`  ✓ Bucket created`);
      } else {
        console.log(`  [DRY RUN] Would create bucket`);
      }
    }

    // List all files in GCS for this bucket
    const bucketPrefix = `supabase-buckets/${BACKUP_DATE}/${bucketName}/`;
    const result = await restoreBucket(supabase, gcsBucket, bucketName, bucketPrefix);
    
    totalFiles += result.count;
    totalBytes += result.bytes;
    skippedFiles += result.skipped;
    errorFiles += result.errors;
    
    console.log(`  Summary: ${result.count} restored, ${result.skipped} skipped, ${result.errors} errors`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('RESTORE COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Files restored: ${totalFiles}`);
  console.log(`  Total size: ${formatBytes(totalBytes)}`);
  console.log(`  Skipped (already exist): ${skippedFiles}`);
  console.log(`  Errors: ${errorFiles}`);
}

async function listAvailableBackups(gcsBucket) {
  console.log('Available backup dates:');
  console.log('');
  
  try {
    // List all prefixes under supabase-buckets/
    const [files] = await gcsBucket.getFiles({ 
      prefix: 'supabase-buckets/',
      delimiter: '/'
    });

    // Get unique dates from file paths
    const dates = new Set();
    
    // Also check for prefixes (folders)
    const [, , apiResponse] = await gcsBucket.getFiles({ 
      prefix: 'supabase-buckets/',
      delimiter: '/',
      autoPaginate: false
    });
    
    if (apiResponse?.prefixes) {
      for (const prefix of apiResponse.prefixes) {
        const match = prefix.match(/supabase-buckets\/(\d{4}-\d{2}-\d{2})\//);
        if (match) {
          dates.add(match[1]);
        }
      }
    }

    // Also scan files for dates
    const [allFiles] = await gcsBucket.getFiles({ 
      prefix: 'supabase-buckets/',
      maxResults: 1000
    });

    for (const file of allFiles) {
      const match = file.name.match(/supabase-buckets\/(\d{4}-\d{2}-\d{2})\//);
      if (match) {
        dates.add(match[1]);
      }
    }

    const sortedDates = Array.from(dates).sort().reverse();
    
    if (sortedDates.length === 0) {
      console.log('  No backups found in GCS bucket');
    } else {
      for (const date of sortedDates) {
        // Count files for this date
        const [dateFiles] = await gcsBucket.getFiles({ 
          prefix: `supabase-buckets/${date}/`,
          maxResults: 10000
        });
        
        // Group by bucket
        const bucketCounts = {};
        let totalSize = 0;
        for (const file of dateFiles) {
          const match = file.name.match(/supabase-buckets\/\d{4}-\d{2}-\d{2}\/([^/]+)\//);
          if (match) {
            bucketCounts[match[1]] = (bucketCounts[match[1]] || 0) + 1;
          }
          totalSize += parseInt(file.metadata?.size || 0);
        }
        
        console.log(`  📅 ${date}`);
        console.log(`     Total: ${dateFiles.length} files (${formatBytes(totalSize)})`);
        for (const [bucket, count] of Object.entries(bucketCounts)) {
          console.log(`       - ${bucket}: ${count} files`);
        }
        console.log('');
      }
    }
  } catch (error) {
    console.error('Error listing backups:', error.message);
  }
}

async function restoreBucket(supabase, gcsBucket, bucketName, prefix) {
  let count = 0;
  let bytes = 0;
  let skipped = 0;
  let errors = 0;

  // Get all files from GCS for this bucket
  const [gcsFiles] = await gcsBucket.getFiles({ prefix });

  console.log(`  Found ${gcsFiles.length} files in backup`);

  for (const gcsFile of gcsFiles) {
    // Extract the original path from the GCS path
    // GCS path: supabase-buckets/YYYY-MM-DD/bucket-name/path/to/file.ext
    // Original path: path/to/file.ext
    const originalPath = gcsFile.name.replace(prefix, '');
    
    if (!originalPath) continue; // Skip if empty (folder entries)

    try {
      // Check if file already exists in Supabase
      if (!OVERWRITE_EXISTING) {
        const { data: existingFile } = await supabase.storage
          .from(bucketName)
          .list(originalPath.split('/').slice(0, -1).join('/'), {
            limit: 1,
            search: originalPath.split('/').pop()
          });

        if (existingFile && existingFile.length > 0 && existingFile.some(f => f.name === originalPath.split('/').pop())) {
          console.log(`    ⏭ Skipping (exists): ${originalPath}`);
          skipped++;
          continue;
        }
      }

      if (DRY_RUN) {
        const [metadata] = await gcsFile.getMetadata();
        const size = parseInt(metadata.size || 0);
        console.log(`    [DRY RUN] Would restore: ${originalPath} (${formatBytes(size)})`);
        count++;
        bytes += size;
        continue;
      }

      // Download from GCS
      const [fileContents] = await gcsFile.download();
      const [metadata] = await gcsFile.getMetadata();
      
      // Upload to Supabase
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(originalPath, fileContents, {
          contentType: metadata.contentType || 'application/octet-stream',
          upsert: OVERWRITE_EXISTING
        });

      if (uploadError) {
        console.error(`    ❌ Error uploading ${originalPath}: ${uploadError.message}`);
        errors++;
        continue;
      }

      count++;
      bytes += fileContents.length;
      console.log(`    ✓ Restored: ${originalPath} (${formatBytes(fileContents.length)})`);
    } catch (err) {
      console.error(`    ❌ Error processing ${originalPath}: ${err.message}`);
      errors++;
    }
  }

  return { count, bytes, skipped, errors };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

main().catch(err => {
  console.error('Restore failed:', err);
  process.exit(1);
});
