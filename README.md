# Natural Ball Player - Training Portal

A comprehensive baseball training management system built with React and Supabase.

## Features

✅ **Profile Management** - Upload avatars, manage player profiles
✅ **Messages System** - Send/receive messages with reply threading
✅ **Calendar View** - Week/month toggle with inline event creation
✅ **Separate Event Types** - Team events, workouts, and meals as distinct items
✅ **Training Programs** - Full CRUD for multi-day training programs
✅ **Meal Plans** - Complete nutrition planning system
✅ **Schedule Events** - Quick templates for practices, games, tournaments
✅ **Admin Settings** - User and team management
✅ **Player Dashboard** - Performance stats and upcoming events

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, Lucide Icons
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **State Management**: React Hooks
- **Styling**: Tailwind CSS

## Quick Start

### 1. Clone/Download Project

```bash
# Extract all files to a folder called 'natural-ball-player'
```

### 2. Install Dependencies

```bash
cd natural-ball-player
npm install
```

### 3. Setup Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor
3. Run `complete_database_schema.sql`
4. Go to Storage
5. Create bucket: `avatars` (make it PUBLIC)
6. Get your project URL and anon key from Settings → API

### 4. Configure Supabase Client

Edit `src/supabaseClient.js`:

```javascript
const supabaseUrl = 'YOUR_SUPABASE_URL_HERE'
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY_HERE'
```

### 5. Run Development Server

```bash
npm start
```

App will open at [http://localhost:3000](http://localhost:3000)

## Project Structure

```
natural-ball-player/
├── public/
│   ├── index.html
│   ├── manifest.json
│   └── robots.txt
├── src/
│   ├── AdminSettings.js      # User & team management
│   ├── App.js                 # Main app component
│   ├── CoachTools.js          # Schedules, workouts, meals
│   ├── Messages.js            # Messaging system
│   ├── PlayerDashboard.js     # Player stats & schedule view
│   ├── Profile.js             # Profile with avatar upload
│   ├── Schedule.js            # Calendar view with inline creation
│   ├── supabaseClient.js      # Supabase configuration
│   ├── index.js               # Entry point
│   ├── index.css              # Global styles + animations
│   └── ...
├── complete_database_schema.sql  # Database setup
├── package.json
├── tailwind.config.js
└── README.md
```

## User Roles

### Player
- View own schedule and stats
- Send/receive messages
- View training programs and meal plans assigned to them
- Upload profile picture

### Coach
- All player permissions
- Create and manage schedules
- Create and assign training programs
- Create and assign meal plans
- View all team data

### Admin
- All coach permissions
- Create and manage users
- Create and manage teams
- Full system access

## Key Features Explained

### Calendar with Inline Creation

Hover over any day → Click "+ Add" → Choose:
- **Team Event** (practice/game/tournament)
- **Workout** (assign training program)
- **Meal** (assign meal plan)

### Separate Event Types

Events are now distinct types:
- Team Events (blue/green) - practices and games
- Workouts (purple) - training sessions
- Meals (orange) - nutrition plans

### Training Programs

Multi-day programs with:
- Days (Day 1, Day 2, etc.)
- Exercises per day
- Categories (hitting, pitching, fielding, etc.)
- Sets, reps, weights
- Video/image links

### Meal Plans

Complete nutrition planning:
- Individual meals with macros
- Meal plans (collections of meals)
- Assign to teams or players
- Track calories, protein, carbs, fat

## Database Schema

See `complete_database_schema.sql` for full schema.

Key tables:
- `users` - User accounts and profiles
- `teams` - Team definitions
- `schedule_events` - Calendar events (all types)
- `training_programs` - Workout programs
- `meal_plans` - Nutrition plans
- `messages` - Message system
- `performance_stats` - Player statistics

## Deployment

### Build for Production

```bash
npm run build
```

### Deploy to Vercel/Netlify

1. Connect your Git repository
2. Set build command: `npm run build`
3. Set output directory: `build`
4. Add environment variables (if needed)

### Deploy to Supabase Hosting

```bash
# Coming soon - Supabase hosting integration
```

## Development

### Available Scripts

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from Create React App (one-way)

### Adding New Features

1. Create component in `src/`
2. Import in `App.js` or parent component
3. Add route/view logic
4. Update database schema if needed

## Troubleshooting

### "Invalid API key"
- Check `supabaseClient.js` has correct URL and key
- Verify key is anon/public key, not service key

### "Row Level Security" errors
- Ensure RLS policies are created (run schema SQL)
- Check user is authenticated

### Avatar upload not working
- Verify `avatars` bucket exists in Supabase Storage
- Ensure bucket is PUBLIC
- Check file size < 5MB

### Calendar events not showing
- Verify schedule_events table has data
- Check team_id matches user's team
- Ensure event_date is in correct format (YYYY-MM-DD)

## Contributing

This is a private project. If you have access and want to contribute:

1. Create a feature branch
2. Make changes
3. Test thoroughly
4. Submit for review

## License

Private/Proprietary - All rights reserved

## Support

For issues or questions, contact the project admin.

---

Built with ⚾ by the Natural Ball Player team
