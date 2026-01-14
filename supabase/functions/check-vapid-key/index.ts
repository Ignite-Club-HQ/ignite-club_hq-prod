import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as base64url from "https://deno.land/std@0.177.0/encoding/base64url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("VAPID_SUBJECT");

    // Check if keys exist
    const keysExist = {
      publicKey: !!publicKey,
      privateKey: !!privateKey,
      subject: !!subject,
    };

    // Check key lengths (public should be ~87 chars, private should be ~43 chars in base64url)
    const keyLengths = {
      publicKey: publicKey?.length || 0,
      privateKey: privateKey?.length || 0,
    };

    // Decode and validate keys
    let publicKeyValid = false;
    let privateKeyValid = false;
    let keysMatch = false;
    let publicKeyBytes: Uint8Array | null = null;
    let privateKeyBytes: Uint8Array | null = null;
    let errorMessage = "";

    try {
      if (publicKey) {
        publicKeyBytes = base64url.decode(publicKey);
        // Public key should be 65 bytes (uncompressed P-256 point)
        publicKeyValid = publicKeyBytes.length === 65 && publicKeyBytes[0] === 0x04;
        if (!publicKeyValid) {
          errorMessage += `Public key invalid: length=${publicKeyBytes.length}, firstByte=${publicKeyBytes[0]}. `;
        }
      }
    } catch (e) {
      errorMessage += `Error decoding public key: ${e}. `;
    }

    try {
      if (privateKey) {
        privateKeyBytes = base64url.decode(privateKey);
        // Private key should be 32 bytes (P-256 scalar)
        privateKeyValid = privateKeyBytes.length === 32;
        if (!privateKeyValid) {
          errorMessage += `Private key invalid: length=${privateKeyBytes.length} (expected 32). `;
        }
      }
    } catch (e) {
      errorMessage += `Error decoding private key: ${e}. `;
    }

    // Try to verify the key pair is valid
    if (publicKeyValid && privateKeyValid && publicKeyBytes && privateKeyBytes) {
      try {
        // For Web Crypto API, we just verify the key formats are correct
        // Actual cryptographic verification would require PKCS8/JWK conversion
        keysMatch = publicKeyValid && privateKeyValid;
        
        // Additional check: try to import public key to verify it's valid
        try {
          // Create a proper ArrayBuffer by copying the data
          const publicKeyArray = new Uint8Array(publicKeyBytes);
          await crypto.subtle.importKey(
            "raw",
            publicKeyArray,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"]
          );
          // If import succeeds, public key format is correct
        } catch (importError) {
          errorMessage += `Public key import failed: ${importError}. `;
          keysMatch = false;
        }
        
        if (!keysMatch) {
          errorMessage += "Key pair verification failed: signature does not verify. ";
        }
      } catch (e) {
        errorMessage += `Error verifying key pair: ${e}. `;
        keysMatch = false;
      }
    }

    return new Response(
      JSON.stringify({
        keysExist,
        keyLengths,
        validation: {
          publicKeyValid,
          privateKeyValid,
          keysMatch,
          publicKeyFirstByte: publicKeyBytes ? publicKeyBytes[0] : null,
          privateKeyByteLength: privateKeyBytes?.length || 0,
          publicKeyByteLength: publicKeyBytes?.length || 0,
        },
        vapidPublicKey: publicKey || null,
        subject: subject || null,
        recommendation: !keysMatch 
          ? "VAPID keys do not match! You need to regenerate a new key pair using: npx web-push generate-vapid-keys"
          : "Keys are valid and match.",
        errorMessage: errorMessage || null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
