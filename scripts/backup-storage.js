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

const MANIFEST_PATH = 'supabase-buckets/.backup-manifest.json';

/**
 * Generate a mapping of storage file paths to their club/team associations
 * by querying the database tables that reference storage files.
 */
async function generateFileMapping(supabase) {
  const mapping = {
    generatedAt: new Date().toISOString(),
    photos: [],
    chatAttachments: [],
    vaultFiles: [],
    sponsorLogos: [],
    clubLogos: [],
    avatars: []
  };

  // Fetch photos with club/team associations
  try {
    const { data: photos, error } = await supabase
      .from('photos')
      .select(`
        id,
        image_url,
        file_url,
        club_id,
        team_id,
        uploader_id,
        folder_id,
        created_at,
        clubs:club_id (name),
        teams:team_id (name, club_id)
      `)
      .is('deleted_at', null);
    
    if (!error && photos) {
      mapping.photos = photos.map(p => ({
        id: p.id,
        storagePath: extractStoragePath(p.image_url || p.file_url, 'photos'),
        clubId: p.club_id,
        clubName: p.clubs?.name || null,
        teamId: p.team_id,
        teamName: p.teams?.name || null,
        uploaderId: p.uploader_id,
        folderId: p.folder_id,
        createdAt: p.created_at
      }));
    }
  } catch (err) {
    console.error('Error fetching photos mapping:', err.message);
  }

  // Fetch vault files (chat attachments stored in photos bucket but referenced in vault_files)
  try {
    const { data: vaultFiles, error } = await supabase
      .from('vault_files')
      .select(`
        id,
        file_url,
        name,
        club_id,
        team_id,
        uploader_id,
        folder_id,
        created_at,
        clubs:club_id (name),
        teams:team_id (name)
      `);
    
    if (!error && vaultFiles) {
      mapping.vaultFiles = vaultFiles.map(f => ({
        id: f.id,
        storagePath: extractStoragePath(f.file_url, 'photos'),
        name: f.name,
        clubId: f.club_id,
        clubName: f.clubs?.name || null,
        teamId: f.team_id,
        teamName: f.teams?.name || null,
        uploaderId: f.uploader_id,
        folderId: f.folder_id,
        createdAt: f.created_at
      }));
    }
  } catch (err) {
    console.error('Error fetching vault files mapping:', err.message);
  }

  // Fetch chat attachments from messages (team, club, group, broadcast)
  try {
    // Team messages with images
    const { data: teamMsgs } = await supabase
      .from('team_messages')
      .select(`
        id, image_url, team_id, author_id, created_at,
        teams:team_id (name, club_id, clubs:club_id (name))
      `)
      .not('image_url', 'is', null);
    
    if (teamMsgs) {
      for (const msg of teamMsgs) {
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'team',
          storagePath: extractStoragePath(msg.image_url, 'chat-attachments'),
          teamId: msg.team_id,
          teamName: msg.teams?.name || null,
          clubId: msg.teams?.club_id || null,
          clubName: msg.teams?.clubs?.name || null,
          authorId: msg.author_id,
          createdAt: msg.created_at
        });
      }
    }

    // Club messages with images
    const { data: clubMsgs } = await supabase
      .from('club_messages')
      .select(`
        id, image_url, club_id, author_id, created_at,
        clubs:club_id (name)
      `)
      .not('image_url', 'is', null);
    
    if (clubMsgs) {
      for (const msg of clubMsgs) {
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'club',
          storagePath: extractStoragePath(msg.image_url, 'chat-attachments'),
          clubId: msg.club_id,
          clubName: msg.clubs?.name || null,
          authorId: msg.author_id,
          createdAt: msg.created_at
        });
      }
    }

    // Group messages with images
    const { data: groupMsgs } = await supabase
      .from('group_messages')
      .select(`
        id, image_url, group_id, author_id, created_at,
        chat_groups:group_id (name, club_id, team_id)
      `)
      .not('image_url', 'is', null);
    
    if (groupMsgs) {
      for (const msg of groupMsgs) {
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'group',
          storagePath: extractStoragePath(msg.image_url, 'chat-attachments'),
          groupId: msg.group_id,
          groupName: msg.chat_groups?.name || null,
          clubId: msg.chat_groups?.club_id || null,
          teamId: msg.chat_groups?.team_id || null,
          authorId: msg.author_id,
          createdAt: msg.created_at
        });
      }
    }

    // Broadcast messages with images
    const { data: broadcastMsgs } = await supabase
      .from('broadcast_messages')
      .select('id, image_url, author_id, created_at')
      .not('image_url', 'is', null);
    
    if (broadcastMsgs) {
      for (const msg of broadcastMsgs) {
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'broadcast',
          storagePath: extractStoragePath(msg.image_url, 'chat-attachments'),
          authorId: msg.author_id,
          createdAt: msg.created_at
        });
      }
    }
  } catch (err) {
    console.error('Error fetching chat attachments mapping:', err.message);
  }

  // Fetch sponsor logos
  try {
    const { data: sponsors } = await supabase
      .from('sponsors')
      .select(`
        id, logo_url, name, club_id, team_id,
        clubs:club_id (name),
        teams:team_id (name)
      `);
    
    if (sponsors) {
      mapping.sponsorLogos = sponsors.filter(s => s.logo_url).map(s => ({
        id: s.id,
        storagePath: extractStoragePath(s.logo_url, 'sponsor-logos'),
        name: s.name,
        clubId: s.club_id,
        clubName: s.clubs?.name || null,
        teamId: s.team_id,
        teamName: s.teams?.name || null
      }));
    }
  } catch (err) {
    console.error('Error fetching sponsor logos mapping:', err.message);
  }

  // Fetch club logos (from clubs table)
  try {
    const { data: clubs } = await supabase
      .from('clubs')
      .select('id, name, logo_url')
      .not('logo_url', 'is', null);
    
    if (clubs) {
      mapping.clubLogos = clubs.map(c => ({
        id: c.id,
        storagePath: extractStoragePath(c.logo_url, 'club-logos'),
        clubName: c.name
      }));
    }
  } catch (err) {
    console.error('Error fetching club logos mapping:', err.message);
  }

  // Fetch user avatars
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .not('avatar_url', 'is', null);
    
    if (profiles) {
      mapping.avatars = profiles.map(p => ({
        userId: p.id,
        displayName: p.display_name,
        storagePath: extractStoragePath(p.avatar_url, 'avatars')
      }));
    }
  } catch (err) {
    console.error('Error fetching avatars mapping:', err.message);
  }

  return mapping;
}

/**
 * Extract the storage path from a full Supabase storage URL
 */
function extractStoragePath(url, bucket) {
  if (!url) return null;
  
  // Handle different URL formats
  // Format 1: https://xxx.supabase.co/storage/v1/object/public/bucket/path
  // Format 2: https://xxx.supabase.co/storage/v1/object/sign/bucket/path?token=...
  const patterns = [
    new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`),
    new RegExp(`/storage/v1/object/sign/${bucket}/([^?]+)`),
    new RegExp(`/storage/v1/object/${bucket}/(.+)$`),
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // If no pattern matches, return the URL as-is for manual inspection
  return url;
}

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

  // Generate file mapping from database before backing up files
  console.log('\nGenerating file mapping from database...');
  const fileMapping = await generateFileMapping(supabase);
  
  // Save file mapping to GCS
  const fileMappingPath = `supabase-buckets/${datePrefix}/file-mapping.json`;
  await gcsBucket.file(fileMappingPath).save(JSON.stringify(fileMapping, null, 2), {
    contentType: 'application/json',
    metadata: {
      metadata: {
        description: 'Maps storage file paths to club/team associations',
        backupDate: datePrefix,
        photoCount: String(fileMapping.photos?.length || 0),
        chatAttachmentCount: String(fileMapping.chatAttachments?.length || 0),
        vaultFileCount: String(fileMapping.vaultFiles?.length || 0)
      }
    }
  });
  console.log(`✓ File mapping saved: ${fileMappingPath}`);
  console.log(`  - Photos: ${fileMapping.photos?.length || 0}`);
  console.log(`  - Chat attachments: ${fileMapping.chatAttachments?.length || 0}`);
  console.log(`  - Vault files: ${fileMapping.vaultFiles?.length || 0}`);

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

        const gcsPath = `supabase-buckets/${datePrefix}/${bucketName}/${filePath}`;
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
