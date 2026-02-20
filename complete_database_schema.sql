-- ═══════════════════════════════════════════════════════════════
-- NATURAL BALL PLAYER - COMPLETE DATABASE SCHEMA
-- ═══════════════════════════════════════════════════════════════
-- Run this entire file in Supabase SQL Editor to set up your database
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: CORE TABLES
-- ═══════════════════════════════════════════════════════════════

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'coach', 'player')),
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team members junction table
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('coach', 'player')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

-- Player profiles (additional info for players)
CREATE TABLE IF NOT EXISTS player_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  jersey_number TEXT,
  position TEXT,
  grade TEXT,
  bats TEXT CHECK (bats IN ('Right', 'Left', 'Switch')),
  throws TEXT CHECK (throws IN ('Right', 'Left')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 2: SCHEDULE & EVENTS
-- ═══════════════════════════════════════════════════════════════

-- Schedule events (supports team events, workouts, and meals)
CREATE TABLE IF NOT EXISTS schedule_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('game', 'practice', 'workout', 'meal')),
  opponent TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME NOT NULL,
  location TEXT NOT NULL,
  address TEXT,
  home_away TEXT CHECK (home_away IN ('home', 'away')),
  is_optional BOOLEAN DEFAULT FALSE,
  notes TEXT,
  training_program_id UUID,
  meal_plan_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add constraint for event type data integrity
ALTER TABLE schedule_events DROP CONSTRAINT IF EXISTS valid_event_type_data;
ALTER TABLE schedule_events ADD CONSTRAINT valid_event_type_data CHECK (
  (event_type IN ('game', 'practice') AND training_program_id IS NULL AND meal_plan_id IS NULL) OR
  (event_type = 'workout' AND training_program_id IS NOT NULL) OR
  (event_type = 'meal' AND meal_plan_id IS NOT NULL)
);

-- STEP 3: TRAINING PROGRAMS
-- ═══════════════════════════════════════════════════════════════

-- Training programs
CREATE TABLE IF NOT EXISTS training_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  duration_weeks INTEGER,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training days within a program
CREATE TABLE IF NOT EXISTS training_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES training_programs(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  title TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Individual exercises within a training day
CREATE TABLE IF NOT EXISTS training_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id UUID REFERENCES training_days(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('hitting', 'pitching', 'fielding', 'conditioning', 'recovery', 'other')),
  name TEXT NOT NULL,
  description TEXT,
  sets INTEGER,
  reps TEXT,
  weight TEXT,
  video_url TEXT,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Training program assignments (to teams or players)
CREATE TABLE IF NOT EXISTS training_program_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES training_programs(id) ON DELETE CASCADE,
  player_id UUID REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK ((player_id IS NOT NULL AND team_id IS NULL) OR (player_id IS NULL AND team_id IS NOT NULL))
);

-- Add foreign key for training_program_id in schedule_events
ALTER TABLE schedule_events ADD CONSTRAINT fk_training_program 
  FOREIGN KEY (training_program_id) REFERENCES training_programs(id) ON DELETE SET NULL;

-- STEP 4: MEAL PLANS
-- ═══════════════════════════════════════════════════════════════

-- Individual meals
CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  calories INTEGER,
  protein_g NUMERIC(10,2),
  carbs_g NUMERIC(10,2),
  fat_g NUMERIC(10,2),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meal plans (collections of meals)
CREATE TABLE IF NOT EXISTS meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meal plan items (junction table)
CREATE TABLE IF NOT EXISTS meal_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE,
  meal_id UUID REFERENCES meals(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meal plan assignments (to teams or players)
CREATE TABLE IF NOT EXISTS meal_plan_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE,
  player_id UUID REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK ((player_id IS NOT NULL AND team_id IS NULL) OR (player_id IS NULL AND team_id IS NOT NULL))
);

-- Add foreign key for meal_plan_id in schedule_events
ALTER TABLE schedule_events ADD CONSTRAINT fk_meal_plan 
  FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id) ON DELETE SET NULL;

-- STEP 5: PERFORMANCE STATS
-- ═══════════════════════════════════════════════════════════════

-- Performance stats (Trackman, HitTrax, WHOOP)
CREATE TABLE IF NOT EXISTS performance_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  -- Trackman
  exit_velocity NUMERIC(10,2),
  launch_angle NUMERIC(10,2),
  spin_rate INTEGER,
  -- HitTrax
  avg_distance NUMERIC(10,2),
  hard_hit_rate NUMERIC(10,2),
  line_drive_rate NUMERIC(10,2),
  -- WHOOP
  recovery_score INTEGER,
  strain NUMERIC(10,2),
  sleep_hours NUMERIC(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 6: MESSAGES
-- ═══════════════════════════════════════════════════════════════

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 7: INDEXES FOR PERFORMANCE
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_schedule_events_date ON schedule_events(event_date);
CREATE INDEX IF NOT EXISTS idx_schedule_events_team ON schedule_events(team_id);
CREATE INDEX IF NOT EXISTS idx_schedule_events_training_program ON schedule_events(training_program_id);
CREATE INDEX IF NOT EXISTS idx_schedule_events_meal_plan ON schedule_events(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_performance_stats_player ON performance_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_performance_stats_date ON performance_stats(date);

-- STEP 8: ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_program_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can read all, but only update their own
CREATE POLICY "Users can view all users" ON users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);

-- RLS Policies: Teams - all can read, admins/coaches can modify
CREATE POLICY "Anyone can view teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Admins/coaches can insert teams" ON teams FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'coach'))
);

-- RLS Policies: Team members - all can read
CREATE POLICY "Anyone can view team members" ON team_members FOR SELECT USING (true);

-- RLS Policies: Schedule events - all can read
CREATE POLICY "Anyone can view schedule events" ON schedule_events FOR SELECT USING (true);
CREATE POLICY "Coaches can insert events" ON schedule_events FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'coach'))
);

-- RLS Policies: Training programs - all can read
CREATE POLICY "Anyone can view training programs" ON training_programs FOR SELECT USING (true);
CREATE POLICY "Anyone can view training days" ON training_days FOR SELECT USING (true);
CREATE POLICY "Anyone can view training exercises" ON training_exercises FOR SELECT USING (true);

-- RLS Policies: Meals - all can read
CREATE POLICY "Anyone can view meals" ON meals FOR SELECT USING (true);
CREATE POLICY "Anyone can view meal plans" ON meal_plans FOR SELECT USING (true);
CREATE POLICY "Anyone can view meal plan items" ON meal_plan_items FOR SELECT USING (true);

-- RLS Policies: Messages - users can read their own
CREATE POLICY "Users can view received messages" ON messages FOR SELECT USING (
  auth.uid() = receiver_id OR auth.uid() = sender_id
);
CREATE POLICY "Users can send messages" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Users can update received messages" ON messages FOR UPDATE USING (auth.uid() = receiver_id);

-- RLS Policies: Performance stats - players see own, coaches see all
CREATE POLICY "Players can view own stats" ON performance_stats FOR SELECT USING (
  auth.uid() = player_id OR 
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'coach'))
);

-- ═══════════════════════════════════════════════════════════════
-- SETUP COMPLETE!
-- ═══════════════════════════════════════════════════════════════
-- 
-- NEXT STEPS:
-- 1. Go to Storage in Supabase
-- 2. Create bucket: "avatars"
-- 3. Make it PUBLIC
-- 4. Done!
--
-- ═══════════════════════════════════════════════════════════════
