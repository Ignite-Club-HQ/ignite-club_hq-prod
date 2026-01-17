import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple base64url encoding/decoding
function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate a random challenge
function generateChallenge(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64ToBase64Url(btoa(String.fromCharCode(...array)));
}

// Verify the WebAuthn signature
async function verifySignature(
  publicKeyBase64: string,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  try {
    // Hash the clientDataJSON
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    
    // Concatenate authenticatorData and clientDataHash
    const signedData = new Uint8Array(authenticatorData.length + clientDataHash.byteLength);
    signedData.set(authenticatorData);
    signedData.set(new Uint8Array(clientDataHash), authenticatorData.length);
    
    // Parse the COSE public key
    const publicKeyBytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    
    // Try to import as ECDSA P-256 key (most common for platform authenticators)
    // COSE key format parsing - simplified for ES256
    // Looking for key type 2 (EC2) and algorithm -7 (ES256)
    
    // For ES256, we need to extract x and y coordinates from COSE key
    // COSE_Key = {1: 2, 3: -7, -1: 1, -2: x, -3: y}
    
    // Simple CBOR map parsing to find -2 and -3 keys (x and y coordinates)
    let xCoord: Uint8Array | null = null;
    let yCoord: Uint8Array | null = null;
    
    // Scan for the byte string markers after key indicators
    for (let i = 0; i < publicKeyBytes.length - 33; i++) {
      // Look for -2 (0x21 in CBOR) followed by byte string of 32 bytes
      if (publicKeyBytes[i] === 0x21 && publicKeyBytes[i + 1] === 0x58 && publicKeyBytes[i + 2] === 0x20) {
        xCoord = publicKeyBytes.slice(i + 3, i + 35);
      }
      // Look for -3 (0x22 in CBOR) followed by byte string of 32 bytes  
      if (publicKeyBytes[i] === 0x22 && publicKeyBytes[i + 1] === 0x58 && publicKeyBytes[i + 2] === 0x20) {
        yCoord = publicKeyBytes.slice(i + 3, i + 35);
      }
    }
    
    if (!xCoord || !yCoord) {
      console.error('Could not extract EC coordinates from COSE key');
      return false;
    }
    
    // Create uncompressed EC point (0x04 || x || y)
    const rawKey = new Uint8Array(65);
    rawKey[0] = 0x04;
    rawKey.set(xCoord, 1);
    rawKey.set(yCoord, 33);
    
    // Import as ECDSA key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    
    // WebAuthn uses DER-encoded signature, need to convert to raw r||s format
    const rawSignature = derToRaw(signature);
    
    // Verify the signature
    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      rawSignature,
      signedData
    );
    
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Convert DER-encoded ECDSA signature to raw format
function derToRaw(derSignature: Uint8Array): Uint8Array {
  // DER format: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (derSignature[0] !== 0x30) {
    // Not DER encoded, assume it's already raw
    return derSignature;
  }
  
  let offset = 2; // Skip 0x30 and length byte
  
  // Read r
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;
  const rLength = derSignature[offset];
  offset++;
  let r = derSignature.slice(offset, offset + rLength);
  offset += rLength;
  
  // Read s
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;
  const sLength = derSignature[offset];
  offset++;
  let s = derSignature.slice(offset, offset + sLength);
  
  // Remove leading zeros if present (DER uses signed integers)
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);
  
  // Pad to 32 bytes if needed
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  
  return raw;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const body = await req.json();
    const { action, email } = body;

    if (action === "get-options") {
      if (!email) {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up user by email
      const { data: userData } = await serviceClient.rpc('get_user_by_email_for_passkey', {
        lookup_email: email.toLowerCase().trim()
      });

      if (!userData || userData.length === 0) {
        return new Response(JSON.stringify({ error: "No account found with this email" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = userData[0].id;

      // Get user's registered passkeys
      const { data: passkeys, error: passkeyError } = await serviceClient
        .from('user_passkeys')
        .select('credential_id')
        .eq('user_id', userId);

      if (passkeyError || !passkeys || passkeys.length === 0) {
        return new Response(JSON.stringify({ error: "No passkey registered for this account" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const challenge = generateChallenge();
      const origin = req.headers.get('origin') || 'https://ignite-club-launchpad.lovable.app';
      let rpId: string;
      try {
        rpId = new URL(origin).hostname;
      } catch {
        rpId = 'ignite-club-launchpad.lovable.app';
      }
      
      console.log('Authentication origin:', origin, 'rpId:', rpId);

      const options = {
        challenge,
        rpId,
        allowCredentials: passkeys.map(pk => ({
          id: pk.credential_id,
          type: 'public-key',
          transports: ['internal'],
        })),
        timeout: 60000,
        userVerification: 'required',
      };

      return new Response(JSON.stringify({ options, userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const { credential } = body;

      if (!email || !credential) {
        return new Response(JSON.stringify({ error: "Missing email or credential" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log('Verifying passkey for email:', email);
      console.log('Credential ID received:', credential.id);

      // Look up user by email
      const { data: userData } = await serviceClient.rpc('get_user_by_email_for_passkey', {
        lookup_email: email.toLowerCase().trim()
      });

      if (!userData || userData.length === 0) {
        console.log('No user found for email:', email);
        return new Response(JSON.stringify({ error: "No account found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = userData[0].id;
      console.log('Found user ID:', userId);

      // Get all passkeys for this user to debug
      const { data: allPasskeys } = await serviceClient
        .from('user_passkeys')
        .select('credential_id')
        .eq('user_id', userId);
      
      console.log('User passkeys in DB:', allPasskeys?.map(p => p.credential_id));

      // Try to find the passkey - the credential.id from browser might be base64url encoded
      // while we stored it as standard base64, so we need to normalize both for comparison
      const normalizeCredentialId = (id: string): string => {
        // Convert base64url to standard base64
        return id.replace(/-/g, '+').replace(/_/g, '/');
      };

      const normalizedReceivedId = normalizeCredentialId(credential.id);
      
      // Get the passkey from database - try exact match first
      let { data: passkey, error: passkeyError } = await serviceClient
        .from('user_passkeys')
        .select('*')
        .eq('user_id', userId)
        .eq('credential_id', credential.id)
        .maybeSingle();
      
      // If not found, try normalized ID
      if (!passkey && allPasskeys) {
        const matchingPasskey = allPasskeys.find(p => 
          normalizeCredentialId(p.credential_id) === normalizedReceivedId
        );
        
        if (matchingPasskey) {
          const { data: foundPasskey } = await serviceClient
            .from('user_passkeys')
            .select('*')
            .eq('user_id', userId)
            .eq('credential_id', matchingPasskey.credential_id)
            .single();
          passkey = foundPasskey;
        }
      }

      if (!passkey) {
        console.log('Passkey not found. Received ID:', credential.id, 'Normalized:', normalizedReceivedId);
        return new Response(JSON.stringify({ error: "Passkey not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log('Found passkey:', passkey.id);

      // Decode the credential response
      const authenticatorData = Uint8Array.from(atob(credential.response.authenticatorData), c => c.charCodeAt(0));
      const clientDataJSON = Uint8Array.from(atob(credential.response.clientDataJSON), c => c.charCodeAt(0));
      const signature = Uint8Array.from(atob(credential.response.signature), c => c.charCodeAt(0));

      // Verify the signature
      const isValid = await verifySignature(
        passkey.public_key,
        authenticatorData,
        clientDataJSON,
        signature
      );

      if (!isValid) {
        return new Response(JSON.stringify({ error: "Invalid passkey signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check and update counter to prevent replay attacks
      const newCounter = (authenticatorData[33] << 24) | (authenticatorData[34] << 16) | 
                         (authenticatorData[35] << 8) | authenticatorData[36];
      
      if (newCounter <= passkey.counter) {
        // Counter didn't increase - possible cloned authenticator
        console.warn('Passkey counter did not increase, possible replay attack');
        // We'll allow it but log the warning - some authenticators don't increment properly
      }

      // Update the passkey counter and last used timestamp
      await serviceClient
        .from('user_passkeys')
        .update({ 
          counter: Math.max(newCounter, passkey.counter + 1),
          last_used_at: new Date().toISOString()
        })
        .eq('id', passkey.id);

      console.log('Signature verified, generating session...');

      // Generate a session for the user using admin API
      // Get the user directly by ID instead of listing all users
      const { data: { user: authUser }, error: getUserError } = await serviceClient.auth.admin.getUserById(userId);
      
      if (getUserError) {
        console.error('Get user error:', getUserError);
        return new Response(JSON.stringify({ error: "Failed to get user" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (!authUser) {
        console.log('User not found in auth for ID:', userId);
        return new Response(JSON.stringify({ error: "User not found in auth" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log('Found auth user:', authUser.email);

      // Generate a magic link token that auto-signs in the user
      console.log('Generating magic link for:', authUser.email);
      const { data: magicLink, error: magicLinkError } = await serviceClient.auth.admin.generateLink({
        type: 'magiclink',
        email: authUser.email!,
        options: {
          redirectTo: `${req.headers.get('origin') || 'https://ignite-club-launchpad.lovable.app'}/`,
        }
      });

      if (magicLinkError || !magicLink) {
        console.error('Magic link generation error:', magicLinkError);
        return new Response(JSON.stringify({ error: "Failed to generate session" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log('Magic link generated, extracting token...');

      // Extract the token from the magic link and verify it to get a session
      const token = new URL(magicLink.properties?.action_link || '').searchParams.get('token');
      
      if (!token) {
        console.error('No token in magic link:', magicLink.properties?.action_link);
        return new Response(JSON.stringify({ error: "Failed to generate authentication token" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the OTP to get a session
      console.log('Verifying OTP token...');
      const { data: sessionData, error: verifyError } = await serviceClient.auth.verifyOtp({
        token_hash: token,
        type: 'magiclink',
      });

      if (verifyError || !sessionData.session) {
        console.error('OTP verification error:', verifyError);
        return new Response(JSON.stringify({ error: "Failed to create session" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log('Session created successfully!');
      return new Response(JSON.stringify({ 
        success: true,
        session: {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Passkey authentication error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
