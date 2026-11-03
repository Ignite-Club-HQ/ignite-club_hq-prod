# Make PROD a straight copy of DEV

## Goal
Get back to the original rule: code is proven on your DEV services, and a merge copies that same code to PROD. Nothing is set up only on PROD.

## Where things stand
- DEV Group 1 and Group 2 run the same code and work in the app.
- 17 of the 18 PROD services run different code, built from the live branch with the extra safeguard code that DEV never received.
- The main branch also contains that safeguard code, but it was never installed on DEV.
- PROD has no member data, and both groups are closed.

## Steps

1. **Freeze PROD-only work.** No more safeguard, signing-key or member-access runs. The keys and the safeguard service already on PROD stay but go unused.

2. **Pick the code DEV should run.** Choose one of these:
   - **A. Keep DEV as it is (simplest):** find the main-branch commit that matches DEV's fingerprints, and treat that as the release.
   - **B. Take the newer code:** first check, without changing anything, whether the newer main code works on DEV without the extra safeguard setup. If it would lock members out, remove that requirement from the code first.

3. **Upgrade DEV** to the chosen code with the existing DEV upgrade jobs on GitHub (upgrade only, nothing wiped). Then confirm in the app that sign-in, clubs, chats, events and photos work. This step is skipped under option A, since DEV already runs that code.

4. **Copy that exact code to the live branch.** Only the service code moves. Database and website files stay as they are.

5. **Upgrade PROD** with the existing PROD upgrade job, upgrade only. Before it starts, a check confirms the older code can safely take over each service's saved data. If any service can't, stop and ask before doing anything else. Groups stay closed.

6. **Read back fingerprints.** For each PROD service, compare the code it now runs with its DEV counterpart, and save the comparison as a report.

7. **From then on:** the only route to PROD is a merge after DEV has been upgraded and checked.

Opening the groups and pointing `igniteclubhq.app` at PROD stay separate steps, each needing your approval.

## Technical details
- Fingerprints are read from each service's public code fingerprint, which changes nothing.
- Builds use pinned tools, so DEV and PROD fingerprints can be compared exactly. If a build differs only because of the build machine, the report says so.
- The PROD upgrade checks that each service's saved data is still compatible with the older code. If it isn't, it stops instead of wiping.
- PROD-only safeguard settings saved on services are left in place, and the copied code ignores them.
