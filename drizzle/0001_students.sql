CREATE TABLE IF NOT EXISTS students (
  student_number TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  gender TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS student_sessions (
  token_hash TEXT PRIMARY KEY,
  student_number TEXT NOT NULL REFERENCES students(student_number) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS student_sessions_expiry ON student_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_limits (bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS auth_limits_window ON auth_limits(window);
