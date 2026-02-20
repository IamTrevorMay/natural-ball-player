# 📋 Natural Ball Player - Installation Checklist

⏱️ Total Time: 15 minutes

## ✅ Step-by-Step Installation

### 1. Create React App (3 min)

```bash
npx create-react-app natural-ball-player
cd natural-ball-player
```

### 2. Replace package.json (1 min)

- Delete the default `package.json`
- Copy provided `package.json` to project root
- Run: `npm install`

### 3. Setup Public Folder (2 min)

In `public/` folder:
- Replace `index.html`
- Replace `manifest.json`
- Add `robots.txt`

### 4. Setup Source Files (5 min)

In `src/` folder, delete everything and add:

**Core Files:**
- [ ] index.js
- [ ] index.css
- [ ] App.css
- [ ] App.js
- [ ] supabaseClient.js ⚠️ UPDATE YOUR KEYS!
- [ ] reportWebVitals.js
- [ ] setupTests.js

**Components:**
- [ ] Schedule.js
- [ ] Profile.js
- [ ] CoachTools.js
- [ ] Messages.js
- [ ] PlayerDashboard.js
- [ ] AdminSettings.js

### 5. Setup Config Files (1 min)

In project root:
- [ ] tailwind.config.js
- [ ] .gitignore (rename from gitignore.txt)

### 6. Database Setup (3 min)

1. Go to your Supabase project
2. Open SQL Editor
3. Copy entire contents of `complete_database_schema.sql`
4. Run it
5. Wait for success message

### 7. Storage Setup (1 min)

1. Go to Storage in Supabase
2. Click "New bucket"
3. Name: `avatars`
4. **IMPORTANT: Make it PUBLIC** ✅
5. Create bucket

### 8. Update Supabase Keys (1 min)

Edit `src/supabaseClient.js`:

```javascript
const supabaseUrl = 'https://YOUR_PROJECT.supabase.co'
const supabaseAnonKey = 'your-anon-key-here'
```

Get these from: Supabase → Settings → API

### 9. Start Development Server (1 min)

```bash
npm start
```

Should open at http://localhost:3000

## ✅ Post-Installation Checks

### Test Login
- [ ] Can see login page
- [ ] No console errors

### Create Test User
```sql
-- Run in Supabase SQL Editor
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES 
  (gen_random_uuid(), 'coach@test.com', crypt('password123', gen_salt('bf')), NOW());

INSERT INTO users (id, email, full_name, role)
SELECT id, email, 'Test Coach', 'coach'
FROM auth.users WHERE email = 'coach@test.com';
```

Or use Supabase Auth UI to create user manually.

### Test Features
- [ ] Login works
- [ ] Dashboard loads
- [ ] Can navigate to Schedule
- [ ] Can navigate to Profile
- [ ] Can navigate to Messages (if coach/admin)
- [ ] Can navigate to Coach Tools (if coach/admin)

## 🎉 Success!

If all checks pass, you're ready to go!

## 🐛 Common Issues

### "Cannot find module '@supabase/supabase-js'"
- Run: `npm install`

### "Invalid API key"
- Check supabaseClient.js has correct URL and key
- Make sure you're using ANON key, not SERVICE key

### "Table does not exist"
- Run complete_database_schema.sql in Supabase SQL Editor

### "Permission denied for bucket avatars"
- Go to Storage → avatars bucket → Make it PUBLIC

### App not starting
- Delete node_modules: `rm -rf node_modules`
- Delete package-lock.json: `rm package-lock.json`
- Reinstall: `npm install`
- Try again: `npm start`

## 📚 Next Steps

1. Create some test users in Admin Settings
2. Create a team
3. Add team events to calendar
4. Create training programs
5. Create meal plans
6. Test the whole workflow!

## 🚀 Ready to Deploy?

See README.md for deployment instructions.

---

Need help? Check the README.md for more detailed information!
