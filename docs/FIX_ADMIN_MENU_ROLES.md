# Fix: Administration Menu Not Showing for System Admins

## Problem
Jennifer (and other system admins) were not seeing the Administration menu items in the dynamic menu, even though they had the `system_admin` role assigned in the database.

## Root Cause
The system has two role mechanisms:
1. **`users.role_id`** - A single "primary" role column (legacy/simplified)
2. **`user_roles` table** - Multiple roles via junction table (full RBAC)

Jennifer's `system_admin` role was stored in the `user_roles` table, but:
- The profile service only fetched the single role from `users.role_id`
- The frontend menu system expected an array of roles in `user.roles`
- After login, only basic user info (without roles) was stored in localStorage
- Pages used this incomplete localStorage data instead of fetching the full profile

## Solution
Made the following changes to ensure roles from `user_roles` table are loaded and accessible to the menu system:

### Backend Changes

#### 1. `user-profile.repository.js`
Added new method to fetch all roles from `user_roles` table:
```javascript
async getUserRoles(userId) {
  // Fetches all roles from user_roles junction table
  // Returns array of role objects with permissions
}
```

#### 2. `user-profile.service.js`
Updated `getProfile()` to include roles array:
```javascript
async getProfile(userId, orgId) {
  // ...existing code...
  const userRoles = await this.repository.getUserRoles(userId);
  
  return {
    // ...existing fields...
    roles: userRoles, // NEW: All roles from user_roles table
  };
}
```

#### 3. `user-profile.routes.js`
Updated API response to include roles:
```javascript
res.json({
  profile: {
    // ...existing fields...
    roles: profile.roles, // NEW: Include roles array in response
  }
});
```

### Frontend Changes

#### 4. `api.js`
Added new method to load full profile and update localStorage:
```javascript
async loadUserProfile() {
  // Fetches /api/v1/users/me/profile
  // Extracts roles array from response
  // Updates this.user and localStorage with full profile including roles
}
```

#### 5. Page Initialization Updates
Updated `index.html`, `matters.html`, and `chat.html` to:
- Call `api.loadUserProfile()` before rendering the menu
- Ensures roles are loaded into localStorage before menu system checks them

## How It Works Now

1. **User logs in** → Basic auth succeeds (status check)
2. **Page loads** → Calls `api.loadUserProfile()`
3. **Profile API** → Returns user data including ALL roles from `user_roles` table
4. **localStorage** → Updated with `user.roles = [...]` array
5. **Menu System** → Reads `user.roles` from localStorage
6. **Role Check** → `hasRole(['system_admin'])` succeeds
7. **Admin Menu** → Visible! ✅

## Testing
After these changes:
1. Log out completely
2. Log back in as Jennifer
3. The Administration section should now be visible with:
   - Users
   - Roles & Permissions
   - Audit Logs
   - System Health
   - Plugins

## Files Modified
- `src/services/processor/repositories/user-profile.repository.js`
- `src/services/processor/services/user-profile.service.js`
- `src/services/processor/routes/user-profile.routes.js`
- `public_html/js/api.js`
- `public_html/index.html`
- `public_html/matters.html`
- `public_html/chat.html`

## Notes
- The mock data file (`mock-data.js`) was also updated, but this only affects demo mode
- The seed file already had Jennifer correctly assigned the system_admin role
- The fix ensures BOTH role systems work: `users.role_id` AND `user_roles` table
- All pages that render the dynamic menu now properly load roles first

---
**Date:** December 5, 2025  
**Fixed by:** Cursor AI Assistant
