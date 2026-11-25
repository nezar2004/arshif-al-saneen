CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, department TEXT NOT NULL REFERENCES departments(id), name TEXT NOT NULL, UNIQUE(department,name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES subjects(id), title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('mid','final','makeup')), year INTEGER NOT NULL, note TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, paper TEXT NOT NULL REFERENCES papers(id), name TEXT NOT NULL, mime TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS papers_subject ON papers(subject);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS files_paper ON files(paper);
