import { encryptInventedNameLocally } from './local-encryption.mjs';

// The POC intentionally has NO window.openai bridge, tools/call, postMessage,
// fetch, XHR, beacon, localStorage, third-party script or canister write.
const form = document.getElementById('demo-form');
const input = document.getElementById('test-name');
const button = document.getElementById('encrypt-button');
const result = document.getElementById('result');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  button.disabled = true;
  try {
    const verified = encryptInventedNameLocally(input.value);
    // Report only an outcome and byte count. Do not render the entered name
    // or serialize ciphertext into the DOM, a URL, a log, or model-visible data.
    result.textContent = verified.encryptedLocally
      ? 'Local VetKeys encryption completed (' + verified.ciphertextBytes + ' ciphertext bytes). The result was discarded; nothing was submitted.'
      : 'Encryption could not be confirmed.';
  } catch {
    result.textContent = 'Encryption test was refused. Use an invented name of at most 80 characters.';
  } finally {
    input.value = '';
    button.disabled = false;
  }
});
