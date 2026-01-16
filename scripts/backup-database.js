/**
 * Supabase Database Backup to Google Cloud Storage
 * 
 * This script exports data from Supabase database tables to JSON files
 * and uploads them to GCS for backup purposes.
 */

import { createClient } from '@supabase/supabase-js';
import { Storage } from '@google-cloud/storage';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Tables to backup - ordered by dependencies (referenced tables first)
const TABLES_TO_BACKUP = [
  'profiles',
  'clubs',
  'club_subscriptions',
  'club_stripe_configs',
  'club_invites',
  'club_rewards',
  'teams',
  'team_invites',
  'children',
  'child_team_assignments',
  'user_roles',
  'role_requests',
  'pending_invites',
  'events',
  'rsvps',
  'duties',
  'event_payments',
  'event_sponsors',
  'player_of_match',
  'game_player_stats',
  'game_summaries',
  'active_games',
  'pitch_formations',
  'sponsors',
  'sponsor_analytics',
  'photos',
  'photo_comments',
  'photo_reactions',
  'photo_comment_reactions',
  'vault_folders',
  'vault_files',
  'team_messages',
  'club_messages',
  'broadcast_messages',
  'group_messages',
  'chat_groups',
  'message_reactions',
  'message_reads',
  'chat_mute_preferences',
  'notifications',
  'notification_preferences',
  'push_subscriptions',
  'push_notification_logs',
  'feedback',
  'promo_codes',
  'reward_redemptions',
  'member_subscription_payments',
  'favorite_event_titles',
  'favorite_opponents',
  'app_ads',
  'app_ad_analytics',
  'app_ad_settings',
  'app_stripe_config',
  'audit_logs',
  'typing_indicators'
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GCS_BUCKET_NAME) {
    throw new Error('Missing required environment variables');
  }

  console.log('Connecting to Supabase:', SUPABASE_URL);
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const gcs = new Storage();
  const gcsBucket = gcs.bucket(GCS_BUCKET_NAME);

  const datePrefix = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  let totalTables = 0;
  let totalRows = 0;
  let totalBytes = 0;
  const errors = [];

  console.log(`Starting database backup to GCS bucket: ${GCS_BUCKET_NAME}`);
  console.log(`Date prefix: ${datePrefix}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log('---');

  // Create a backup manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    tables: {}
  };

  for (const tableName of TABLES_TO_BACKUP) {
    console.log(`\nBacking up table: ${tableName}`);
    
    try {
      // Fetch all rows from the table (paginated for large tables)
      const allRows = await fetchAllRows(supabase, tableName);
      
      if (allRows === null) {
        console.log(`  ⚠ Table "${tableName}" does not exist or is empty, skipping`);
        continue;
      }

      const rowCount = allRows.length;
      const jsonData = JSON.stringify(allRows, null, 2);
      const buffer = Buffer.from(jsonData, 'utf-8');
      const byteSize = buffer.length;

      // Upload to GCS
      const gcsPath = `supabase-database/${datePrefix}/${tableName}.json`;
      
      await gcsBucket.file(gcsPath).save(buffer, {
        contentType: 'application/json',
        metadata: {
          metadata: {
            tableName: tableName,
            rowCount: rowCount.toString(),
            backupDate: datePrefix,
            timestamp: timestamp
          }
        }
      });

      totalTables++;
      totalRows += rowCount;
      totalBytes += byteSize;

      manifest.tables[tableName] = {
        rowCount,
        byteSize,
        path: gcsPath
      };

      console.log(`  ✓ Backed up ${rowCount} rows (${formatBytes(byteSize)}) to ${gcsPath}`);
    } catch (error) {
      console.error(`  ✗ Error backing up ${tableName}:`, error.message);
      errors.push({ table: tableName, error: error.message });
    }
  }

  // Save manifest
  manifest.summary = {
    totalTables,
    totalRows,
    totalBytes,
    errors
  };

  const manifestPath = `supabase-database/${datePrefix}/backup-manifest.json`;
  await gcsBucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), {
    contentType: 'application/json'
  });

  console.log('\n---');
  console.log(`Database backup complete:`);
  console.log(`  Tables: ${totalTables}`);
  console.log(`  Total rows: ${totalRows}`);
  console.log(`  Total size: ${formatBytes(totalBytes)}`);
  console.log(`  Manifest: ${manifestPath}`);
  
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    errors.forEach(e => console.log(`    - ${e.table}: ${e.error}`));
  }
}

async function fetchAllRows(supabase, tableName, pageSize = 1000) {
  const allRows = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + pageSize - 1);

    if (error) {
      // Check if table doesn't exist
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        return null;
      }
      throw error;
    }

    if (data && data.length > 0) {
      allRows.push(...data);
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

main().catch(err => {
  console.error('Database backup failed:', err);
  process.exit(1);
});
