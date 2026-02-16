

# Automated Android Publishing to Google Play

## What You Need to Do (Outside Lovable)

### Step 1: Create a Google Cloud Service Account
1. Go to **Google Play Console** > **Setup** > **API access**
2. Click **Link** to connect your Google Cloud project (or create one)
3. Click **Create new service account** -- this takes you to Google Cloud Console
4. In Google Cloud Console, create a service account with any name (e.g. "codemagic-publish")
5. Grant it no special Cloud roles (permissions come from Play Console)
6. Create a **JSON key** for the service account and download it

### Step 2: Grant Permissions in Play Console
1. Back in **Google Play Console** > **Setup** > **API access**, you should see the new service account listed
2. Click **Manage** next to it
3. Under **App permissions**, add your app and grant **Release to production, exclude devices, and use Play App Signing**
4. Save

### Step 3: Add the JSON Key to Codemagic
1. In **Codemagic** > **Teams** > **Global variables & secrets** (or your app settings)
2. Create a new environment variable:
   - Name: `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`
   - Value: paste the **entire contents** of the downloaded JSON key file
   - Mark as **Secure**
3. Add it to your existing `android_signing` group (or create a new group like `google_play` and reference both groups)

### Step 4: I Will Update codemagic.yaml
Once you confirm the above is done, I will add the `publishing` section to your Android workflow:

```yaml
publishing:
  google_play:
    credentials: $GCLOUD_SERVICE_ACCOUNT_CREDENTIALS
    track: internal          # Start with internal testing track
    submit_as_draft: true    # Review before going live
```

This publishes your AAB directly to Google Play's **internal testing** track as a draft. You can change `track` to `alpha`, `beta`, or `production` later, and set `submit_as_draft: false` to auto-submit.

---

## Technical Details

- The `publishing` block is added to the existing `android-debug-workflow` in `codemagic.yaml`
- The environment group referencing the service account credentials will be added to the workflow's `environment.groups` list
- No other workflow changes are needed -- the existing build already produces the signed `.aab` artifact that Google Play expects

## Steps Summary
1. You: Create service account + JSON key in Google Cloud
2. You: Grant Play Console permissions to the service account
3. You: Add the JSON key as `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` in Codemagic
4. Me: Update `codemagic.yaml` with the publishing config

Let me know once steps 1-3 are done and I will make the code change.

