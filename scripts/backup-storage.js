/**
 * Supabase Storage Backup to Google Cloud Storage
 * 
 * This script backs up all files from Supabase storage buckets to GCS.
 * It preserves the bucket/folder structure and adds a date prefix.
 */

import { createClient } from '@supabase/supabase-js';
import { Storage } from '@google-cloud/storage';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Buckets to backup
const BUCKETS_TO_BACKUP = [
  'app-ads',
  'sponsor-logos', 
  'photos',
  'chat-attachments',
  'avatars',
  'backups'
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GCS_BUCKET_NAME) {
    throw new Error('Missing required environment variables');
  }

  console.log('Connecting to Supabase:', SUPABASE_URL);
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const gcs = new Storage();
  const gcsBucket = gcs.bucket(GCS_BUCKET_NAME);

  // First, list all available buckets
  const { data: availableBuckets, error: bucketsError } = await supabase.storage.listBuckets();
  
  if (bucketsError) {
    console.error('Error listing buckets:', bucketsError);
  } else {
    console.log('Available buckets:', availableBuckets.map(b => b.name).join(', '));
  }

  const datePrefix = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let totalFiles = 0;
  let totalBytes = 0;

  console.log(`Starting backup to GCS bucket: ${GCS_BUCKET_NAME}`);
  console.log(`Date prefix: ${datePrefix}`);
  console.log('---');

  for (const bucketName of BUCKETS_TO_BACKUP) {
    console.log(`\nProcessing bucket: ${bucketName}`);
    
    // Check if bucket exists
    const bucketExists = availableBuckets?.some(b => b.name === bucketName);
    if (!bucketExists) {
      console.log(`  ⚠ Bucket "${bucketName}" does not exist, skipping`);
      continue;
    }
    
    try {
      const filesBackedUp = await backupBucket(supabase, gcsBucket, bucketName, datePrefix);
      totalFiles += filesBackedUp.count;
      totalBytes += filesBackedUp.bytes;
      console.log(`  ✓ Backed up ${filesBackedUp.count} files (${formatBytes(filesBackedUp.bytes)})`);
    } catch (error) {
      console.error(`  ✗ Error backing up ${bucketName}:`, error.message);
    }
  }

  console.log('\n---');
  console.log(`Backup complete: ${totalFiles} files, ${formatBytes(totalBytes)}`);
}

async function backupBucket(supabase, gcsBucket, bucketName, datePrefix, path = '') {
  let count = 0;
  let bytes = 0;

  console.log(`    Listing path: "${path || '(root)'}"`);
  
  const { data: files, error } = await supabase.storage
    .from(bucketName)
    .list(path, { 
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (error) {
    console.error(`    Error listing ${bucketName}/${path}:`, error);
    throw error;
  }

  console.log(`    Found ${files?.length || 0} items in ${bucketName}/${path || '(root)'}`);

  for (const file of files || []) {
    const filePath = path ? `${path}/${file.name}` : file.name;

    // Check if it's a folder (no metadata means it's a folder)
    if (!file.metadata) {
      console.log(`    📁 Folder: ${filePath}`);
      // It's a folder, recurse
      const subResult = await backupBucket(supabase, gcsBucket, bucketName, datePrefix, filePath);
      count += subResult.count;
      bytes += subResult.bytes;
    } else {
      // It's a file, download and upload to GCS
      console.log(`    📄 File: ${filePath}`);
      try {
        const { data, error: downloadError } = await supabase.storage
          .from(bucketName)
          .download(filePath);

        if (downloadError) {
          console.error(`      Error downloading ${filePath}:`, downloadError.message);
          continue;
        }

        const gcsPath = `${datePrefix}/${bucketName}/${filePath}`;
        const buffer = Buffer.from(await data.arrayBuffer());
        
        await gcsBucket.file(gcsPath).save(buffer, {
          metadata: {
            contentType: file.metadata?.mimetype || 'application/octet-stream',
            metadata: {
              originalBucket: bucketName,
              originalPath: filePath,
              backupDate: datePrefix
            }
          }
        });

        count++;
        bytes += buffer.length;
        console.log(`      ✓ Uploaded to GCS: ${gcsPath} (${formatBytes(buffer.length)})`);
      } catch (err) {
        console.error(`      Error processing ${filePath}:`, err.message);
      }
    }
  }

  return { count, bytes };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
