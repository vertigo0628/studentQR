-- Create the students table
CREATE TABLE students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  name TEXT NOT NULL,
  student_id TEXT NOT NULL UNIQUE, -- Check if this needs to be unique on encrypted data or plain. Since we encrypt deterministically, we can keep unique constraint if the encrypted value is unique.
  email TEXT NOT NULL UNIQUE,
  course TEXT NOT NULL,
  year INTEGER NOT NULL,
  image TEXT NOT NULL,
  cloudinary_id TEXT
);

-- Enable Row Level Security (RLS) - Optional, but recommended
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for now (since we use service_role key in backend, this might not be strictly needed, but good practice if checking via dashboard)
-- OR just rely on service_role key which bypasses RLS.

-- For a simple backend-only access pattern using service_role key, RLS policies are skipped. 
-- However, if using the anon key, you'd need policies. 
-- We will assume the backend uses the SERVICE_ROLE_KEY or the anon key with appropriate policies.
-- Let's stick to simple table creation for now.
