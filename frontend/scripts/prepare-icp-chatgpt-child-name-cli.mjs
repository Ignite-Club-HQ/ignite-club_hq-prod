#!/usr/bin/env node
/**
 * Offline CLI for ChatGPT's DFINITY connector + local ICP vetKeys SDK.
 * Read ONE JSON input from stdin (never argv, environment, GitHub variables or
 * URLs); emit only encrypted Candid argument objects to stdout.
 *
 * Usage: trusted process orchestration supplies JSON through an ephemeral
 * stdin pipe, rather than writing a plaintext child-name JSON file to disk.
 * Invoke Node with this script path and pass the input directly to stdin.
 *
 * Never include personal names in process arguments, environment variables,
 * persistent files, GitHub Actions/PR logs or workflow artifacts. This CLI
 * never creates a child or calls a canister; it emits ciphertext arguments.
 */
import { readFileSync } from 'node:fs';
import { prepareChildNameFromIcpConnector } from './prepare-icp-chatgpt-child-name-connector.mjs';

try {
  const source = readFileSync(0, 'utf8');
  if (source.length === 0 || source.length > 150_000) throw Error('Invalid input size');
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    throw Error('Invalid JSON input');
  }
  const encrypted = prepareChildNameFromIcpConnector(input);
  process.stdout.write(JSON.stringify(encrypted) + '\n');
} catch (error) {
  // Strictly fixed refusal messages: no name, receipt body, ciphertext or
  // potentially sensitive JSON parser context ever reaches stderr.
  const safe = [
    'Invalid input size', 'Invalid JSON input',
    'Missing input', 'Wrong application or Internet Identity origin',
    'Wrong or read-only Test3 Internet Identity', 'No ICP service discovery',
    'Group 2 service is not uniquely declared in the canonical manifest',
    'Missing connector receipt', 'Incorrect connector method or canister',
    'Incorrect DEV manifest authority', 'Wrong or anonymous Internet Identity derivation',
    'Missing or oversized connector Candid reply',
    'Missing Parent role grant', 'Missing exact Test3 Parent grant for ChatGPT Plugin Test U10',
    'Missing child creation response', 'Expected one successful create_own_child result',
    'Unverified new child ID', 'New child not owned by Test3',
    'New child already has unexpected assignments', 'Missing Candid key',
    'Expected exactly 96 escaped public key bytes', 'Invalid verification-key length',
  ];
  const message = safe.includes(error?.message) ? error.message : 'Encrypted name preparation refused';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
}
