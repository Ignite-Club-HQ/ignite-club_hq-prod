import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// WebAuthn utilities
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64UrlToBase64(base64url: string): string {
  // Convert base64url to standard base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Handle both base64url and standard base64
  const standardBase64 = base64UrlToBase64(base64);
  const binary = atob(standardBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Check if WebAuthn is available
export function isWebAuthnAvailable(): boolean {
  return !!(
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  );
}

// Check if platform authenticator (biometrics) is available
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Check if user has passkeys stored
const PASSKEY_EMAIL_KEY = 'ignite_passkey_email';
const REMEMBER_ME_KEY = 'ignite_remember_me';

export function getStoredPasskeyEmail(): string | null {
  try {
    return localStorage.getItem(PASSKEY_EMAIL_KEY);
  } catch {
    return null;
  }
}

function setStoredPasskeyEmail(email: string | null) {
  try {
    if (email) {
      localStorage.setItem(PASSKEY_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(PASSKEY_EMAIL_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getRememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setRememberMe(value: boolean) {
  try {
    if (value) {
      localStorage.setItem(REMEMBER_ME_KEY, 'true');
    } else {
      localStorage.removeItem(REMEMBER_ME_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function usePasskey() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      const available = await isPlatformAuthenticatorAvailable();
      setIsAvailable(available);
      
      // Check if user has a stored passkey email
      const storedEmail = getStoredPasskeyEmail();
      setIsRegistered(!!storedEmail);
    };
    checkAvailability();
  }, []);

  // Register a new passkey for the current user
  const registerPasskey = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setLoading(true);
    setError(null);

    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('You must be logged in to register a passkey');
      }

      // Request registration options from server
      const { data: optionsData, error: optionsError } = await supabase.functions.invoke(
        'passkey-register',
        {
          body: { action: 'get-options' },
        }
      );

      if (optionsError || !optionsData?.options) {
        throw new Error(optionsData?.error || 'Failed to get registration options');
      }

      const options = optionsData.options;

      // Create credential using WebAuthn API
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: base64ToArrayBuffer(options.challenge),
          rp: {
            name: options.rp.name,
            id: options.rp.id,
          },
          user: {
            id: base64ToArrayBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout || 60000,
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          attestation: 'none',
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Credential creation was cancelled');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Send credential to server for verification
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'passkey-register',
        {
          body: {
            action: 'verify',
            credential: {
              id: credential.id,
              rawId: arrayBufferToBase64(credential.rawId),
              response: {
                clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
                attestationObject: arrayBufferToBase64(response.attestationObject),
              },
              type: credential.type,
            },
          },
        }
      );

      if (verifyError || !verifyData?.success) {
        throw new Error(verifyData?.error || 'Failed to verify passkey');
      }

      // Store email for future login
      setStoredPasskeyEmail(session.user.email || '');
      setIsRegistered(true);
      setLoading(false);
      return { success: true };
    } catch (err: any) {
      const message = err.name === 'NotAllowedError' 
        ? 'Passkey registration was cancelled or timed out'
        : err.message || 'Failed to register passkey';
      setError(message);
      setLoading(false);
      return { success: false, error: message };
    }
  }, []);

  // Authenticate with passkey
  const authenticateWithPasskey = useCallback(async (email?: string): Promise<{ 
    success: boolean; 
    error?: string;
  }> => {
    setLoading(true);
    setError(null);

    try {
      const lookupEmail = email || getStoredPasskeyEmail();
      if (!lookupEmail) {
        throw new Error('No email provided for passkey authentication');
      }

      // Get authentication options from server
      const { data: optionsData, error: optionsError } = await supabase.functions.invoke(
        'passkey-authenticate',
        {
          body: { action: 'get-options', email: lookupEmail },
        }
      );

      if (optionsError || !optionsData?.options) {
        throw new Error(optionsData?.error || 'Failed to get authentication options');
      }

      const options = optionsData.options;

      // Get credential using WebAuthn API
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64ToArrayBuffer(options.challenge),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials?.map((cred: any) => ({
            id: base64ToArrayBuffer(cred.id),
            type: cred.type,
            transports: cred.transports,
          })),
          timeout: options.timeout || 60000,
          userVerification: 'required',
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Authentication was cancelled');
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      // Send credential to server for verification and get session
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'passkey-authenticate',
        {
          body: {
            action: 'verify',
            email: lookupEmail,
            credential: {
              id: credential.id,
              rawId: arrayBufferToBase64(credential.rawId),
              response: {
                clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
                authenticatorData: arrayBufferToBase64(response.authenticatorData),
                signature: arrayBufferToBase64(response.signature),
                userHandle: response.userHandle ? arrayBufferToBase64(response.userHandle) : null,
              },
              type: credential.type,
            },
          },
        }
      );

      if (verifyError || !verifyData?.success) {
        throw new Error(verifyData?.error || 'Failed to verify passkey');
      }

      // Set session from the returned tokens
      if (verifyData.session) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: verifyData.session.access_token,
          refresh_token: verifyData.session.refresh_token,
        });
        
        if (sessionError) {
          throw new Error('Failed to establish session');
        }
      }

      // Update stored email
      setStoredPasskeyEmail(lookupEmail);
      setLoading(false);
      return { success: true };
    } catch (err: any) {
      const message = err.name === 'NotAllowedError'
        ? 'Passkey authentication was cancelled or timed out'
        : err.message || 'Failed to authenticate with passkey';
      setError(message);
      setLoading(false);
      return { success: false, error: message };
    }
  }, []);

  // Remove passkey registration (client-side only - clears stored email)
  const clearPasskey = useCallback(() => {
    setStoredPasskeyEmail(null);
    setIsRegistered(false);
  }, []);

  return {
    isAvailable,
    isRegistered,
    loading,
    error,
    registerPasskey,
    authenticateWithPasskey,
    clearPasskey,
    getStoredPasskeyEmail,
  };
}
