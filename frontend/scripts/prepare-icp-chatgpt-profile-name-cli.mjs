#!/usr/bin/env node
/**
 * Offline only. Supply one user-approved name and connector evidence via
 * private stdin, NEVER as arguments, environment variables or a file.
 * No canister calls, signer, credentials or network communication.
 */
import { readFileSync } from 'node:fs';
import { prepareOwnProfileFromVerifiedIcp } from './prepare-icp-chatgpt-profile-name-connector.mjs';

try {
  const raw = readFileSync(0, 'utf8');
  if (!raw || raw.length > 250_000) throw Error('Refused');
  const result = prepareOwnProfileFromVerifiedIcp(JSON.parse(raw));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  // Never echo names, principal receipts, public key bytes or parser details.
  process.stderr.write('DEV secure profile-name preparation refused\n');
  process.exitCode = 1;
}
