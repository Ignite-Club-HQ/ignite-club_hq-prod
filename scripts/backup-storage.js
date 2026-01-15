/**
 * Supabase Storage Backup to Google Cloud Storage
 * 
 * This script backs up files from Supabase storage buckets to GCS.
 * It supports incremental backups - only backing up new or modified files.
 */

import { createClient } from '@supabase/supabase-js';
import { Storage } from '@google-cloud/storage';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const INCREMENTAL_BACKUP = process.env.INCREMENTAL_BACKUP === 'true';

// Buckets to backup
const BUCKETS_TO_BACKUP = [
  'app-ads',
  'sponsor-logos', 
  'photos',
  'chat-attachments',
  'avatars',
  'backups'
];

const MANIFEST_PATH = 'storage-backups/.backup-manifest.json';

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GCS_BUCKET_NAME) {
    throw new Error('Missing required environment variables');
  }

  console.log('Connecting to Supabase:', SUPABASE_URL);
  console.log('Incremental backup:', INCREMENTAL_BACKUP ? 'enabled' : 'disabled');
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const gcs = new Storage();
  const gcsBucket = gcs.bucket(GCS_BUCKET_NAME);

  // Load previous manifest if incremental backup is enabled
  let previousManifest = {};
  if (INCREMENTAL_BACKUP) {
    previousManifest = await loadManifest(gcsBucket);
    console.log(`Loaded manifest with ${Object.keys(previousManifest).length} entries`);
  }

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
  let skippedFiles = 0;
  const newManifest = {};

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
      const result = await backupBucket(
        supabase, 
        gcsBucket, 
        bucketName, 
        datePrefix, 
        '', 
        previousManifest, 
        newManifest
      );
      totalFiles += result.count;
      totalBytes += result.bytes;
      skippedFiles += result.skipped;
      console.log(`  ✓ Backed up ${result.count} files (${formatBytes(result.bytes)}), skipped ${result.skipped} unchanged`);
    } catch (error) {
      console.error(`  ✗ Error backing up ${bucketName}:`, error.message);
    }
  }

  // Save the new manifest
  if (INCREMENTAL_BACKUP) {
    await saveManifest(gcsBucket, newManifest);
    console.log(`\nSaved manifest with ${Object.keys(newManifest).length} entries`);
  }

  console.log('\n---');
  if (totalFiles === 0 && skippedFiles > 0) {
    console.log(`Backup complete: No changes detected (${skippedFiles} files unchanged)`);
  } else {
    console.log(`Backup complete: ${totalFiles} files backed up (${formatBytes(totalBytes)}), ${skippedFiles} unchanged`);
  }
}

async function loadManifest(gcsBucket) {
  try {
    const file = gcsBucket.file(MANIFEST_PATH);
    const [exists] = await file.exists();
    
    if (!exists) {
      console.log('No previous manifest found, will backup all files');
      return {};
    }
    
    const [contents] = await file.download();
    return JSON.parse(contents.toString());
  } catch (error) {
    console.error('Error loading manifest:', error.message);
    return {};
  }
}

async function saveManifest(gcsBucket, manifest) {
  try {
    const file = gcsBucket.file(MANIFEST_PATH);
    await file.save(JSON.stringify(manifest, null, 2), {
      contentType: 'application/json',
      metadata: {
        metadata: {
          lastUpdated: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error saving manifest:', error.message);
  }
}

function getFileKey(bucketName, filePath) {
  return `${bucketName}/${filePath}`;
}

function hasFileChanged(fileKey, fileMetadata, previousManifest) {
  const previous = previousManifest[fileKey];
  if (!previous) {
    return true; // New file
  }
  
  // Compare by updated_at timestamp or size
  if (fileMetadata.updated_at !== previous.updated_at) {
    return true;
  }
  if (fileMetadata.size !== previous.size) {
    return true;
  }
  
  return false;
}

async function backupBucket(supabase, gcsBucket, bucketName, datePrefix, path, previousManifest, newManifest) {
  let count = 0;
  let bytes = 0;
  let skipped = 0;

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
      const subResult = await backupBucket(
        supabase, 
        gcsBucket, 
        bucketName, 
        datePrefix, 
        filePath, 
        previousManifest, 
        newManifest
      );
      count += subResult.count;
      bytes += subResult.bytes;
      skipped += subResult.skipped;
    } else {
      const fileKey = getFileKey(bucketName, filePath);
      const fileMetadata = {
        updated_at: file.updated_at,
        size: file.metadata?.size || 0,
        lastBackup: new Date().toISOString()
      };
      
      // Add to new manifest regardless of whether we backup
      newManifest[fileKey] = fileMetadata;
      
      // Check if file has changed (only if incremental backup is enabled)
      if (INCREMENTAL_BACKUP && !hasFileChanged(fileKey, file, previousManifest)) {
        skipped++;
        continue; // Skip unchanged files
      }
      
      // It's a file that needs backup
      console.log(`    📄 File: ${filePath}`);
      try {
        const { data, error: downloadError } = await supabase.storage
          .from(bucketName)
          .download(filePath);

        if (downloadError) {
          console.error(`      Error downloading ${filePath}:`, downloadError.message);
          continue;
        }

        const gcsPath = `storage-backups/${datePrefix}/${bucketName}/${filePath}`;
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

  return { count, bytes, skipped };
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
