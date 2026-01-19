/**
 * Supabase Storage Backup to Google Cloud Storage
 * 
 * This script backs up files from Supabase storage buckets to GCS.
 * It supports incremental backups - only backing up new or modified files.
 * Files are organized by club/team for easy disaster recovery.
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
 * Sanitize a name for use in file paths
 */
function sanitizeName(name) {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) || 'unknown';
}

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
    avatars: [],
    // Lookup maps for quick path resolution
    pathToClubTeam: {}
  };

  // Fetch all clubs for reference
  const { data: allClubs } = await supabase
    .from('clubs')
    .select('id, name, logo_url');
  
  const clubMap = {};
  if (allClubs) {
    for (const club of allClubs) {
      clubMap[club.id] = { name: club.name, logoUrl: club.logo_url };
    }
  }

  // Fetch all teams for reference
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, club_id');
  
  const teamMap = {};
  if (allTeams) {
    for (const team of allTeams) {
      teamMap[team.id] = { 
        name: team.name, 
        clubId: team.club_id,
        clubName: clubMap[team.club_id]?.name || null
      };
    }
  }

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
      mapping.photos = photos.map(p => {
        const storagePath = extractStoragePath(p.image_url || p.file_url, 'photos');
        const clubName = p.clubs?.name || (p.teams?.club_id ? clubMap[p.teams.club_id]?.name : null);
        const teamName = p.teams?.name || null;
        
        // Add to path lookup
        if (storagePath) {
          mapping.pathToClubTeam[`photos/${storagePath}`] = {
            clubId: p.club_id || p.teams?.club_id,
            clubName,
            teamId: p.team_id,
            teamName,
            type: 'photo'
          };
        }
        
        return {
          id: p.id,
          storagePath,
          clubId: p.club_id || p.teams?.club_id,
          clubName,
          teamId: p.team_id,
          teamName,
          uploaderId: p.uploader_id,
          folderId: p.folder_id,
          createdAt: p.created_at
        };
      });
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
      mapping.vaultFiles = vaultFiles.map(f => {
        const storagePath = extractStoragePath(f.file_url, 'photos');
        const clubName = f.clubs?.name || null;
        const teamName = f.teams?.name || null;
        
        // Add to path lookup
        if (storagePath) {
          mapping.pathToClubTeam[`photos/${storagePath}`] = {
            clubId: f.club_id,
            clubName,
            teamId: f.team_id,
            teamName,
            type: 'vault'
          };
        }
        
        return {
          id: f.id,
          storagePath,
          name: f.name,
          clubId: f.club_id,
          clubName,
          teamId: f.team_id,
          teamName,
          uploaderId: f.uploader_id,
          folderId: f.folder_id,
          createdAt: f.created_at
        };
      });
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
        const storagePath = extractStoragePath(msg.image_url, 'chat-attachments');
        const clubName = msg.teams?.clubs?.name || null;
        const teamName = msg.teams?.name || null;
        
        // Add to path lookup
        if (storagePath) {
          mapping.pathToClubTeam[`chat-attachments/${storagePath}`] = {
            clubId: msg.teams?.club_id,
            clubName,
            teamId: msg.team_id,
            teamName,
            type: 'team-chat'
          };
        }
        
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'team',
          storagePath,
          teamId: msg.team_id,
          teamName,
          clubId: msg.teams?.club_id || null,
          clubName,
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
        const storagePath = extractStoragePath(msg.image_url, 'chat-attachments');
        const clubName = msg.clubs?.name || null;
        
        // Add to path lookup
        if (storagePath) {
          mapping.pathToClubTeam[`chat-attachments/${storagePath}`] = {
            clubId: msg.club_id,
            clubName,
            teamId: null,
            teamName: null,
            type: 'club-chat'
          };
        }
        
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'club',
          storagePath,
          clubId: msg.club_id,
          clubName,
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
        const storagePath = extractStoragePath(msg.image_url, 'chat-attachments');
        const clubId = msg.chat_groups?.club_id;
        const teamId = msg.chat_groups?.team_id;
        const clubName = clubId ? clubMap[clubId]?.name : null;
        const teamName = teamId ? teamMap[teamId]?.name : null;
        
        // Add to path lookup
        if (storagePath) {
          mapping.pathToClubTeam[`chat-attachments/${storagePath}`] = {
            clubId,
            clubName,
            teamId,
            teamName,
            type: 'group-chat'
          };
        }
        
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'group',
          storagePath,
          groupId: msg.group_id,
          groupName: msg.chat_groups?.name || null,
          clubId,
          clubName,
          teamId,
          teamName,
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
        const storagePath = extractStoragePath(msg.image_url, 'chat-attachments');
        
        // Add to path lookup (broadcast = system level)
        if (storagePath) {
          mapping.pathToClubTeam[`chat-attachments/${storagePath}`] = {
            clubId: null,
            clubName: null,
            teamId: null,
            teamName: null,
            type: 'broadcast'
          };
        }
        
        mapping.chatAttachments.push({
          id: msg.id,
          type: 'broadcast',
          storagePath,
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
      mapping.sponsorLogos = sponsors.filter(s => s.logo_url).map(s => {
        const storagePath = extractStoragePath(s.logo_url, 'sponsor-logos');
        const clubName = s.clubs?.name || null;
        const teamName = s.teams?.name || null;
        
        // Add to path lookup
        if (storagePath) {
          mapping.pathToClubTeam[`sponsor-logos/${storagePath}`] = {
            clubId: s.club_id,
            clubName,
            teamId: s.team_id,
            teamName,
            type: 'sponsor'
          };
        }
        
        return {
          id: s.id,
          storagePath,
          name: s.name,
          clubId: s.club_id,
          clubName,
          teamId: s.team_id,
          teamName
        };
      });
    }
  } catch (err) {
    console.error('Error fetching sponsor logos mapping:', err.message);
  }

  // Fetch club logos (from clubs table)
  try {
    if (allClubs) {
      mapping.clubLogos = allClubs.filter(c => c.logo_url).map(c => {
        const storagePath = extractStoragePath(c.logo_url, 'club-logos') || 
                           extractStoragePath(c.logo_url, 'photos');
        
        // Add to path lookup
        if (storagePath) {
          const bucket = c.logo_url.includes('/club-logos/') ? 'club-logos' : 'photos';
          mapping.pathToClubTeam[`${bucket}/${storagePath}`] = {
            clubId: c.id,
            clubName: c.name,
            teamId: null,
            teamName: null,
            type: 'club-logo'
          };
        }
        
        return {
          id: c.id,
          storagePath,
          clubName: c.name
        };
      });
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
      mapping.avatars = profiles.map(p => {
        const storagePath = extractStoragePath(p.avatar_url, 'avatars');
        
        // Add to path lookup (avatars are user-level, not club/team)
        if (storagePath) {
          mapping.pathToClubTeam[`avatars/${storagePath}`] = {
            userId: p.id,
            displayName: p.display_name,
            type: 'avatar'
          };
        }
        
        return {
          userId: p.id,
          displayName: p.display_name,
          storagePath
        };
      });
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

/**
 * Determine the organized GCS path for a file based on its club/team association
 */
function getOrganizedPath(datePrefix, bucketName, filePath, fileMapping) {
  const lookupKey = `${bucketName}/${filePath}`;
  const info = fileMapping.pathToClubTeam[lookupKey];
  
  // Base path structure: supabase-buckets/{date}/
  let basePath = `supabase-buckets/${datePrefix}`;
  
  if (!info) {
    // No mapping found - put in _unassociated folder with bucket name
    return `${basePath}/_unassociated/${bucketName}/${filePath}`;
  }
  
  // Handle different file types
  if (info.type === 'avatar') {
    // Avatars go under _users folder
    const userName = sanitizeName(info.displayName) || info.userId?.substring(0, 8) || 'unknown';
    return `${basePath}/_users/${userName}/avatars/${filePath}`;
  }
  
  if (info.type === 'broadcast') {
    // Broadcast messages go under _system folder
    return `${basePath}/_system/broadcast/${filePath}`;
  }
  
  // For club/team associated files
  if (info.clubId && info.clubName) {
    const clubFolder = sanitizeName(info.clubName);
    
    if (info.teamId && info.teamName) {
      // File belongs to a specific team
      const teamFolder = sanitizeName(info.teamName);
      return `${basePath}/clubs/${clubFolder}/teams/${teamFolder}/${bucketName}/${filePath}`;
    } else {
      // File belongs to club level (no specific team)
      return `${basePath}/clubs/${clubFolder}/_club-level/${bucketName}/${filePath}`;
    }
  }
  
  // No club association - put in unassociated
  return `${basePath}/_unassociated/${bucketName}/${filePath}`;
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
  console.log('Files will be organized by club/team for easy disaster recovery');
  console.log('---');

  // Generate file mapping from database before backing up files
  console.log('\nGenerating file mapping from database...');
  const fileMapping = await generateFileMapping(supabase);
  
  // Count files by club for summary
  const clubFileCounts = {};
  for (const [path, info] of Object.entries(fileMapping.pathToClubTeam)) {
    const clubName = info.clubName || '_unassociated';
    const teamName = info.teamName || '_club-level';
    const key = info.clubName ? `${clubName} > ${teamName}` : clubName;
    clubFileCounts[key] = (clubFileCounts[key] || 0) + 1;
  }
  
  console.log('\nFile distribution by club/team:');
  for (const [key, count] of Object.entries(clubFileCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count} files`);
  }
  
  // Save file mapping to GCS
  const fileMappingPath = `supabase-buckets/${datePrefix}/_metadata/file-mapping.json`;
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
  console.log(`\n✓ File mapping saved: ${fileMappingPath}`);
  console.log(`  - Photos: ${fileMapping.photos?.length || 0}`);
  console.log(`  - Chat attachments: ${fileMapping.chatAttachments?.length || 0}`);
  console.log(`  - Vault files: ${fileMapping.vaultFiles?.length || 0}`);
  console.log(`  - Sponsor logos: ${fileMapping.sponsorLogos?.length || 0}`);
  console.log(`  - Club logos: ${fileMapping.clubLogos?.length || 0}`);
  console.log(`  - Avatars: ${fileMapping.avatars?.length || 0}`);

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
        newManifest,
        fileMapping
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

  // Create a restore guide
  const restoreGuidePath = `supabase-buckets/${datePrefix}/_metadata/RESTORE-GUIDE.md`;
  const restoreGuide = `# Backup Restore Guide

## Backup Date: ${datePrefix}

## Folder Structure

This backup is organized by club and team for easy disaster recovery:

\`\`\`
supabase-buckets/${datePrefix}/
├── _metadata/
│   ├── file-mapping.json    # Complete mapping of files to clubs/teams
│   └── RESTORE-GUIDE.md     # This file
├── _system/
│   └── broadcast/           # System-wide broadcast images
├── _users/
│   └── {user-name}/
│       └── avatars/         # User avatar images
├── _unassociated/
│   └── {bucket}/            # Files not linked to any club/team
└── clubs/
    └── {club-name}/
        ├── _club-level/
        │   ├── photos/      # Club-level photos
        │   ├── sponsor-logos/
        │   └── chat-attachments/
        └── teams/
            └── {team-name}/
                ├── photos/
                ├── chat-attachments/
                └── sponsor-logos/
\`\`\`

## How to Restore a Single Club

1. Identify the club folder: \`clubs/{club-name}/\`
2. Download all files from that folder
3. Use the file-mapping.json to recreate database records
4. Upload files back to Supabase storage maintaining the original paths

## How to Restore a Single Team

1. Identify the team folder: \`clubs/{club-name}/teams/{team-name}/\`
2. Download all files from that folder
3. Cross-reference with file-mapping.json for database records
4. Upload files back to Supabase storage

## File Counts

${Object.entries(clubFileCounts).sort((a, b) => b[1] - a[1]).map(([key, count]) => `- ${key}: ${count} files`).join('\n')}

## Notes

- Original bucket and path are preserved in GCS file metadata
- The file-mapping.json contains full database associations
- Avatars are stored separately under _users/
- Unassociated files (no club/team link) are in _unassociated/
`;

  await gcsBucket.file(restoreGuidePath).save(restoreGuide, {
    contentType: 'text/markdown',
    metadata: {
      metadata: {
        backupDate: datePrefix
      }
    }
  });
  console.log(`✓ Restore guide saved: ${restoreGuidePath}`);

  console.log('\n---');
  if (totalFiles === 0 && skippedFiles > 0) {
    console.log(`Backup complete: No changes detected (${skippedFiles} files unchanged)`);
  } else {
    console.log(`Backup complete: ${totalFiles} files backed up (${formatBytes(totalBytes)}), ${skippedFiles} unchanged`);
  }
  console.log(`\nFiles organized by club/team in: supabase-buckets/${datePrefix}/clubs/`);
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

async function backupBucket(supabase, gcsBucket, bucketName, datePrefix, path, previousManifest, newManifest, fileMapping) {
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
        newManifest,
        fileMapping
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

        // Get organized path based on club/team association
        const gcsPath = getOrganizedPath(datePrefix, bucketName, filePath, fileMapping);
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
