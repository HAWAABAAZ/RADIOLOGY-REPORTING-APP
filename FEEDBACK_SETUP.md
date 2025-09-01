# Feedback & Analytics System Setup

## Database Setup Required

To enable the feedback and analytics features, you need to run the database schema in your Supabase project.

### Steps:

1. **Go to your Supabase Dashboard**
   - Visit https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Run the Schema**
   - Copy the contents of `database/feedback-analytics-schema.sql`
   - Paste it into the SQL editor
   - Click "Run" to execute

4. **Create Admin User (Optional)**
   - After running the schema, you can make yourself an admin by running:
   ```sql
   INSERT INTO admin_users (user_id, role, permissions) 
   VALUES ('your-user-id-here', 'super_admin', '["view_feedback", "view_analytics", "manage_users", "manage_admins"]'::jsonb);
   ```
   - Replace `'your-user-id-here'` with your actual Supabase user ID
   - You can find your user ID in the Supabase Auth dashboard

### Features Available After Setup:

✅ **Anonymous Feedback System**
- Users can submit feedback via "💬 Share Feedback" button
- Speech-to-text support for natural English input
- Category selection and star ratings
- Completely anonymous (no personal data stored)

✅ **Admin Dashboard**
- Access via user profile → "📊 Admin Dashboard"
- Real-time user analytics and live user tracking
- Feedback management with filtering and status updates
- Growth metrics and user activity monitoring

✅ **User Activity Tracking**
- Automatic tracking of logins, report generation, template usage
- Session management for live user monitoring
- Page navigation and feature usage analytics

### Troubleshooting:

**If feedback submission fails:**
- Ensure the database schema has been run successfully
- Check the browser console for any errors
- Verify the backend is running on port 3001

**If admin dashboard shows "Access Denied":**
- Make sure you've added yourself as an admin user (step 4 above)
- Use the correct user ID from your Supabase Auth dashboard

**To find your user ID:**
1. Go to Supabase Dashboard → Authentication → Users
2. Find your email and copy the ID column value
3. Use that ID in the admin user insert query

### Database Tables Created:

- `feedback` - Anonymous user feedback
- `user_activities` - User activity tracking
- `user_sessions` - Live session management  
- `daily_user_stats` - Aggregated daily statistics
- `admin_users` - Admin privilege management

The system is now ready to collect valuable user feedback and analytics! 🎉
