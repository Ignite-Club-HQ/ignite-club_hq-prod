

## Rebalance Home Screen: Next Up Above Quick Actions

### What changes

1. **`src/pages/HomePage.tsx`** — Swap the order of two sections:
   - Move `<NextUpCarousel>` (currently line 1598) to right after the welcome message (line 1527), before the Game Timer Widget
   - Move `<HomeQuickActions>` (currently lines 1529-1541) to after the Next Up Carousel and Game Timer Widget

2. **`src/components/HomeQuickActions.tsx`** — Reduce visual dominance:
   - Make the primary "Invite to Team" card less prominent: remove `col-span-2`, use same styling as secondary actions
   - Reduce padding and icon sizes slightly (p-3 → p-2.5, h-9 w-9 → h-8 w-8)
   - Add a subtle section label like "Team Actions" above the grid in muted text

3. **Rename "Join with Code" back to "Join a Team"** — Update the label and description to "Use an invite link to join" in `HomeQuickActions.tsx`

### Technical detail

The swap is purely a reorder of JSX blocks in the HomePage render. The Game Timer Widget stays between Next Up and Quick Actions since it's contextually related to live events. No props, state, or data fetching changes needed.

